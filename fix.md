404 问题诊断与修复报告
问题溯源
通过排查，发现了 两个独立问题：

问题 1：前端 — API 请求打到了自己身上（404 根因）✅ 已修复
项目 详情
现象 POST /api/auth/verify-key → 404，响应 <pre>Cannot POST /api/auth/verify-key</pre>
响应服务器 前端 https://wmrazineousa.sealosgzg.site 的 Express 服务器（不是后端！）
根因 .env.production 被 .gitignore 忽略了，容器里 npm run build 时没有 REACT_APP_API_BASE，导致 API_BASE = ''，所有 API 请求走同源（前端自身）
修复 修改 entrypoint.sh，在 npm run build 之前注入环境变量

# 修复前：npm run build（缺少 REACT_APP_API_BASE）

# 修复后：

export REACT_APP_API_BASE="${REACT_APP_API_BASE:-https://cjdfnwwofgct.sealosgzg.site}"
npm run build
已本地验证：构建产物中正确嵌入了 cjdfnwwofgct.sealosgzg.site 后端地址。

fix.md 诊断的纠偏：fix.md 认为请求"成功击中了 Node.js 后端容器"——但实际上请求到达的是前端的 Express 服务器（serve 基于 Express）。两个容器都返回 X-Powered-By: Express，仅凭此 header 无法区分。

问题 2：后端 — 容器宕机（503）⚠️ 需运维处理
项目 详情
现象 https://cjdfnwwofgct.sealosgzg.site 所有接口返回 503
错误 upstream connect error … delayed connect error: 111（连接拒绝）
含义 istio-envoy 网关正常，但后端 Node.js 容器没有在监听
代码层面 后端所有路由均已正确定义（POST /api/auth/verify-key 等），语法检查全部通过
后端代码本身没有问题，容器宕机可能需要：

在 Sealos 控制台查看容器日志（可能 DB 连接失败、PVC 未挂载等导致 initStorage() 抛出异常）
重启/重新部署后端容器
需要用户操作
重新部署前端 — 将修改后的 entrypoint.sh 推送到仓库并触发 Sealos 重新部署（或手动重建容器镜像）
恢复后端 — 在 Sealos 控制台重启后端容器，查看启动日志排查崩溃原因
