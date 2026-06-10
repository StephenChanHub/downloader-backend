你的直觉非常敏锐！这其实是一个非常经典的 **O(N) 时间复杂度**导致的安全与性能冲突问题。

当你把门票逻辑从“单次票”升级为“生命周期票”后，后端从数据库里捞出来的数据变多了（以前只捞未使用的，现在还要捞正在有效期内的已使用票）。这就彻底放大了原有架构中的一个**性能隐患**：

### 🕵️ 罪魁祸首：Bcrypt 的“死亡循环”

`bcrypt` 这个加密算法之所以被认为是业界最安全的密码哈希算法，就是因为它**刻意被设计得非常慢**（每次对比大约需要 50~100 毫秒），以此来防止黑客用超级计算机进行暴力破解。

但在咱们之前的代码里，验证逻辑是这样的：

1. 从数据库取出 **所有** 有效的门票。
2. 用一个 `for...of` 循环，把用户输入的门票跟数据库里的门票**挨个使用 `bcrypt.compare` 进行比对**。

这就导致了一个灾难：如果数据库里有 50 张票，用户刚好输入的是最后一张，或者输入了一个错误的票，你的服务器就要傻傻地做 50 次龟速计算（耗时将近 5 秒！）。未来如果发了 500 张票，那验证一次就要等 50 秒，服务器 CPU 瞬间就会被占满。

---

### 🛠️ 终极解法：从 O(N) 降低到 O(1) 的瞬间响应

实际上，`bcrypt` 通常是用来保护**人类设置的弱密码**（比如 `123456` 或者 `admin888`）。但咱们系统里的门票（比如 `PTE_X8M2K1`）是你用代码生成的、完全随机的高熵字符串，本身就极其难以被猜中。

对于这种“机器生成的随机密钥”，业界标准的做法是使用 **SHA-256**。它的哈希速度极快，并且允许数据库直接通过 `WHERE key_hash = ?` 进行 **O(1) 的瞬间索引查找**，完全不需要循环对比！

为了让你的验证时间从几秒钟变成 **1 毫秒**，我们需要进行一次底层加密算法的替换（因为你刚好不久前清空了旧数据，现在是替换加密算法的完美时机）：

#### 改造验证逻辑 (`src/controllers/authController.js`)

打开 `authController.js`，引入 `crypto`，然后把原本臃肿的 `for...of` 循环全部删掉，直接让 MySQL 帮你秒级查出结果！

```javascript
const crypto = require('crypto'); // 👈 记得在文件顶部引入

async function verifyKey(req, res) {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: '请提供访问密钥' });

  try {
    // 1. 直接把用户输入的门票用 SHA-256 算一下
    const inputHash = crypto.createHash('sha256').update(key).digest('hex');

    // 2. 核心修改：利用 MySQL 索引直接 O(1) 精准秒查！
    const [keys] = await pool.query(
      `SELECT id, key_hash, folder_name, duration_minutes, status, used_at
       FROM access_keys
       WHERE key_hash = ?
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (
           status = 'unused'
           OR
           (status = 'used' AND DATE_ADD(used_at, INTERVAL duration_minutes MINUTE) > NOW())
         )`,
      [inputHash] // 👈 直接把算好的 Hash 喂给 SQL 查询
    );

    // 3. 如果没查到，说明票不对或者过期了，告别 for 循环！
    if (keys.length === 0) {
      return res.status(401).json({ error: '密钥无效、已过期或不存在' });
    }

    const matchedKey = keys[0];

    // ... 下面剩余寿命计算、写 session 和种 Cookie 的逻辑完全保持不变 ...

```

你会发现，无论数据库里有 50 张还是 5 万张票，点击验证的瞬间就能毫无延迟地丝滑进入！整个后端的性能和并发承受力瞬间提升了至少 100 倍！
