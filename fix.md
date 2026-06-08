# 问：

我才登录两次管理员后台就报请求频繁，检查原因，并且对管理员的限制宽松一点点。

# 答

管理员登录两次就报"请求频繁"
根因：App 组件有一个每 1 秒执行 setTick() 的定时器 → 每秒触发 App 重渲染 → handleAdminSignOut 每次都是新函数引用 → AdminPage 中的 loadFiles 依赖了 onSignOut → 每秒自动调用 adminListFiles() API。

这是一个经典的 React 闭包陷阱。修复分为两层：

层面 修复 文件位置
App 组件 handleUserLogin、handleAdminLogin、handleLockUserSession、handleAdminSignOut 全部用 useCallback(..., []) 包裹 App.jsx:1542-1575
AdminPage loadFiles 改为通过 useRef 引用 onSignOut，依赖数组清空为 []，只挂载时执行一次 App.jsx:1130-1149
