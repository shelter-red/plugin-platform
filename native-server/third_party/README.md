# 第三方依赖

`include/` 中固定了构建所需的头文件：

- nlohmann/json 3.7.3，MIT，<https://github.com/nlohmann/json>
- WebSocket++ 0.8.1，Eclipse Public License 1.0，<https://github.com/zaphoyd/websocketpp>
- standalone Asio 1.12.2，Boost Software License 1.0，<https://think-async.com/Asio/>

这些头文件来自 Ubuntu 对应版本的软件包，仅保留构建所需的 include 内容；`nlohmann/`、`websocketpp/` 和 `asio/` 目录是本地导入缓存，不参与 Git 提交。
