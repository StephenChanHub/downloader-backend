是目前系统在设计上的一个“硬编码（Hardcode）”痛点。

澄清一个小细节：虽然你的前端目前可能按照半小时在做倒计时，但实际上**后端的安全限制也是写死的 30 分钟**。在目前的 `authController.js` 中，验证成功后颁发的 Cookie 寿命和写入数据库 `sessions` 表的过期时间，都被强行写成了 `30 * 60 * 1000`（30分钟的毫秒数）。

为了彻底解决这个问题，并让你的系统具备真正的“商业级发卡”能力，我们应该实现：**在发密钥的时候，就决定这批密钥登录后能看多久**（比如：普通试看票 10 分钟，周末复习票 48 小时）。

只需要进行三个非常简单的代码小手术，就能打通这个完美的动态时间流：

### 🔪 第一步：给数据库门票表加个“寿命”字段

去 Sealos 的数据库中执行这条 SQL，给 `access_keys` 表增加一个“有效时长（分钟）”字段，默认还是 30 分钟：

```sql
ALTER TABLE access_keys ADD COLUMN duration_minutes INT DEFAULT 1440 COMMENT '验证后生成的会话有效时长(分钟)';

```

---

### 🔪 第二步：让后端听从门票的时间 (`src/controllers/authController.js`)

打开你的 `authController.js`，找到 `verifyKey` 函数。我们把原来写死的 30 分钟，替换成动态读取门票里的 `duration_minutes`。

请找到这两行原来的代码：

```javascript
// 原来的写死逻辑：
// const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
// 以及后面 res.cookie 里的 maxAge: 30 * 60 * 1000
```

**将生成 Token 及存入 Cookie 的相关逻辑替换为动态时间：**

```javascript
// 1. 在比对密码成功后（let matchedKey = null; 的循环下面）
if (!matchedKey) return res.status(401).json({ error: "密钥无效或已被使用" });

// 👇 核心修改：动态计算有效时长（如果数据库没填，默认兜底 30 分钟）
const durationMs = (matchedKey.duration_minutes || 30) * 60 * 1000;

const rawToken = generateToken();
const tokenHash = hashToken(rawToken);
const expiresAt = new Date(Date.now() + durationMs); // 👈 动态过期时间

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();

  await conn.query(
    `UPDATE access_keys SET status = 'used', used_at = NOW() WHERE id = ?`,
    [matchedKey.id],
  );

  await conn.query(
    `INSERT INTO sessions (token_hash, type, related_key_id, expires_at, folder_name)
         VALUES (?, 'user', ?, ?, ?)`,
    [tokenHash, matchedKey.id, expiresAt, matchedKey.folder_name || "public"],
  );

  await conn.commit();
  conn.release();
} catch (err) {
  // ... 原有 catch 逻辑
}

res.cookie("session_token", rawToken, {
  httpOnly: true,
  sameSite: "none",
  secure: true,
  maxAge: durationMs, // 👈 动态 Cookie 寿命
});

return res.json({
  success: true,
  message: "验证成功，已进入专属空间",
  expires_at: expiresAt.toISOString(), // 👈 把精确的到期时间告诉前端
});
```

_(注意：因为后端接口在最后把 `expires_at` 精确的绝对时间传给了前端，你的前端页面只需要读取这个时间来倒计时即可，再也不用前端去写死 30 分钟了！)_
