在 Sealos DevBox 中，entrypoint.sh 是一个特殊的脚本文件，它定义了你的应用在发布后的启动方式。本指南将帮助你理解如何正确配置这个文件，以确保你的应用能在部署环境中正确启动和运行。

什么是 entrypoint.sh
在 DevBox 项目中，entrypoint.sh 是应用程序的入口点，它：

定义了应用程序的启动命令
在应用部署后自动执行
确保应用程序以正确的方式启动
是项目发布为 OCI 镜像时的关键组件
entrypoint.sh 只负责启动应用，不应该包含构建步骤。所有的构建工作都应该在开发环境中完成。

开发环境构建
在配置 entrypoint.sh 之前，需要先在开发环境中完成应用构建。这样可以：

减少应用启动时间
避免在生产环境中安装构建依赖
确保部署的是经过验证的构建产物
构建应用
在开发环境中执行构建：

# Next.js 应用

npm run build # 生成 .next 目录

# TypeScript 应用

npm run build # 生成 dist 目录

# Go 应用

go build -o main # 生成可执行文件
验证构建结果
确认构建产物已正确生成：

# 检查构建目录

ls -l dist/ # 或 .next/, build/ 等

# 测试构建产物

node dist/main.js # 或其他启动命令
配置启动命令
根据构建产物配置 entrypoint.sh：

entrypoint.sh

#!/bin/bash

# Next.js

NODE_ENV=production node .next/standalone/server.js

# TypeScript Node.js

node dist/main.js

# Go

./main
常见配置场景
预构建的 Web 应用
entrypoint.sh

#!/bin/bash

# Next.js（已预构建）

NODE_ENV=production node .next/standalone/server.js

# Vue（已预构建）

node server/index.js

# React（已预构建）

serve -s build -l 3000
编译型后端服务
entrypoint.sh

#!/bin/bash

# Go（已编译）

./main

# Java（已打包）

java -jar app.jar

# Rust（已编译）

./server
解释型后端服务
entrypoint.sh

#!/bin/bash

# Python

python app.py

# Node.js（已预构建）

node dist/index.js

# PHP

php -S 0.0.0.0:8000
最佳实践
确保预先构建
在开发环境中完成所有构建步骤
验证构建产物的完整性
测试构建后的应用能否正常启动
使用正确的端口
确保你的应用监听在正确的端口上：

使用环境变量中的端口（如果有）
如果手动指定，使用标准端口（如 3000、8080 等）
确保监听在 0.0.0.0 而不是 localhost
处理环境变量
如果你的应用依赖环境变量：

在部署时通过【应用管理】配置环境变量
不要在 entrypoint.sh 中硬编码敏感信息
不要在 entrypoint.sh 中添加后台进程或守护进程。如果需要运行多个服务，应该创建多个 DevBox 项目分别部署。

常见问题
构建相关问题
如果遇到构建相关的问题：

确保所有构建步骤都在开发环境中完成
检查构建产物是否完整
验证构建产物的运行环境依赖
启动失败
如果应用无法正常启动：

检查启动命令是否指向正确的构建产物
确认所有必需的环境变量都已配置
查看应用日志以获取详细错误信息
权限问题
如果遇到权限错误：

确保 entrypoint.sh 有执行权限：

chmod +x entrypoint.sh
检查构建产物的权限是否正确
测试和验证
在发布应用前：

在开发环境中完成构建
测试构建产物
验证 entrypoint.sh 能正确启动应用：

./entrypoint.sh
下一步操作
完成应用构建并配置好 entrypoint.sh 后，你就可以发布你的应用了。在发布过程中：

确保所有构建产物都已正确生成
系统会使用你配置的 entrypoint.sh 作为应用的启动入口
发布完成后，在部署阶段，应用会按照 entrypoint.sh 中定义的方式启动
