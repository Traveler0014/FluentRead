# 自用 CRX 构建说明

本目录的 `build-crx.yml` 在 fork 远端持续构建 FluentRead 的自用 CRX。

## 一次性准备：配置签名私钥

扩展 ID 由打包私钥决定。要让每次构建出的 crx 都能**原地覆盖升级**同一个已安装扩展，
必须固定同一把私钥，不能每次由 Chrome 随机生成。

1. 本地仓库里已有的自用私钥是 `.output/chrome-mv3.pem`（扩展 ID `onjhlmkombbbelponomfgfiajcicdjph`）。
2. 转成 base64 并写入 GitHub Secret：

   ```bash
   base64 -w0 .output/chrome-mv3.pem
   # 复制输出，然后在 fork 仓库：
   # Settings → Secrets and variables → Actions → New repository secret
   #   Name: CRX_PRIVATE_KEY
   #   Secret: 上面那串 base64
   ```

也可以直接用仓库自带的 GitHub CLI：

```bash
base64 -w0 .output/chrome-mv3.pem | gh secret set CRX_PRIVATE_KEY --repo <你的用户名>/FluentRead
```

> `*.pem` 已被 `.gitignore` 忽略，不要提交私钥。未配置 `CRX_PRIVATE_KEY` 时工作流仍会构建，
> 但会使用一次性密钥，扩展 ID 每次都变，只能手动卸载后重装。

## 触发方式

| 触发 | 行为 |
| --- | --- |
| 推送 `main` | 构建并上传 Actions 制品（不建 Release） |
| 推送 `v*` tag | 构建、上传制品，并创建同名 GitHub Release 附加 crx |
| 手动 `workflow_dispatch` | 构建后上传制品；`tag` 输入填了值就顺带创建 / 覆盖 Release |

## 产物

- Actions 页面对应 run 的 **Artifacts** 区（下载即原文件，不再包一层 zip）：
  - `fluent-read-<版本>-chrome-mv3-<短SHA>.crx`：可直接拖入 `chrome://extensions`；
  - `fluent-read-<版本>-chrome-mv3-<短SHA>.zip`：解压后「加载已解压的扩展程序」。
- 填了 tag 时，同一份文件也会上传到 Releases 页面。

## 为什么需要 `.github/scripts/pin-onnxruntime-node.cjs`

`@huggingface/transformers` 3.x 依赖 `onnxruntime-node@1.21.0`，kokoro / transformers 4.x 依赖
`onnxruntime-node@1.24.3`。两者原生库 soname 都是 `libonnxruntime.so.1`，同一 Node 进程里先加载哪个，
后加载的绑定就会 `dlopen` 失败：

```
libonnxruntime.so.1: version `VERS_1.24.3' not found
```

`postinstall` 会执行 `wxt prepare`，因此 `pnpm install` 和 `pnpm build` 两步都通过 `NODE_OPTIONS`
加载该脚本，把进程内所有 `onnxruntime-node` 请求（含构建工具按绝对路径的 import）收敛到最高版本。
浏览器产物始终使用 `onnxruntime-web`，扩展运行时不受影响。
