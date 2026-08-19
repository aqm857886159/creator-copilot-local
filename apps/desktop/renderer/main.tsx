import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
// 令牌先加载(定义 CSS 变量),再是新壳/工作台样式;旧 styles.css 仍供旧工作台组件使用。
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/script-page.css";
import "./styles/edit-page.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
