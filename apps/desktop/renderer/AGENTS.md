# Renderer 样式与组件规则

- 新页面样式独立成文件,类名带页面前缀(先例:`wb-`、`sp-`),颜色只用 `styles/tokens.css` 令牌;蓝本专有的中性 hover/边框色可逐字取蓝本值。
- 作用域 button/reset 一律写成 `:where(.页面根类) button { … }`。裸 `.根类 button` 特异度 (0,1,1) 会压过所有单类样式——`.sp-root button` 曾让脚本页 chip 边框、must 底色、主按钮药丸全部消失,且 shell.css 犯过同样的错(靠 span 侥幸未爆)。
- contenteditable 中文输入:composition 期间不读值、不触发保存、不被 state 覆写;`compositionend` 后冲刷一次。
- UI 文案全角标点;不渲染背后流程不存在的控件;卡片/闸门文案不承诺代码没做到的事。
