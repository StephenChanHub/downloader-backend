#!/bin/bash
#
# PDF 分发系统 — 部署启动脚本
# 生产环境为默认模式；开发模式需显式传入 "development" 参数
#

app_env=${1:-production}

if [ "$app_env" = "development" ] || [ "$app_env" = "dev" ] ; then
    echo "Development environment detected"
    exec env NODE_ENV=development node src/index.js
else
    echo "Production environment detected"
    exec env NODE_ENV=production node src/index.js
fi
