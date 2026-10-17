# Zotero Literature Importer

一个可部署到 **GitHub Pages** 的中文静态网页，用来把 ChatGPT / GPT Work / Deep Research 整理的论文信息和阅读笔记导入个人 Zotero 文献库。

- 纯前端：HTML + CSS + 原生 JavaScript，**无需 Python、Node、后台服务器、Zotero 桌面客户端**。
- 浏览器直接使用 **Zotero Web API v3**，通过 HTTPS 读取个人文献库，创建论文条目及其子笔记。
- 导入前完整分页读取已有顶层条目，按 **DOI 优先、标题兜底** 检查重复。
- 支持把新论文放入现有 Zotero Collection、附加标签，以及可选为已有论文追加笔记。
- API Key **不会写入 localStorage、Cookie、源代码或导出日志**；关闭或刷新网页即失去本页的授权。
- 不包含统计代码、第三方跟踪器或外部前端依赖。

> **重要**：这是个人非官方工具。默认只支持个人 Zotero library、`journalArticle` 类型和文字笔记。**不会自动查找/下载/上传 PDF**，不会自动校验论文的真实性，也**不能让 GPT Work 在未配置额外工具的情况下直接写入 Zotero**。

## 一、上传 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `zotero-literature-importer`。建议设为 Public（普通 GitHub Pages 免费方案通常用于公开仓库；请以你账户当前权限为准）。
2. 将以下文件上传到仓库**根目录**，文件名不要修改：
   - `index.html`
   - `styles.css`
   - `app.js`
   - `example.json`（可选；示例数据）
   - `README.md`（可选；说明文件）
3. 打开仓库 **Settings → Pages → Build and deployment**。
4. 将 **Source** 设为 `Deploy from a branch`，Branch 选择 `main` 和 `/(root)`，点击 **Save**。
5. 等待部署完成，从 Pages 中打开网站。地址通常为 `https://<GitHub用户名>.github.io/zotero-literature-importer/`。

GitHub Pages 仅托管网页的公开源代码，**不得提交 API Key、自己的研究隐私数据或带凭证的配置文件**。

## 二、准备 Zotero 密钥

1. 登录 [Zotero API Keys](https://www.zotero.org/settings/keys)。
2. 创建专用 private key，建议命名为 `Literature Importer`。
3. 给你的**个人文献库**开启读取、写入权限（包含读取笔记，写入笔记所需权限取决于 Zotero 的密钥授权页面）。不需要群组权限时不要开启。
4. 在该页面找到你的**数字 User ID**（不是用户名/邮箱）。
5. 访问部署好的网页，临时输入 User ID / API Key，点击 **测试连接**。

密钥会作为 `Zotero-API-Key` HTTP 请求头，仅发送到 `https://api.zotero.org`；网页不记录、不持久化它。断开连接、刷新或关闭页面都会清除网页的连接状态。仍需信任你的浏览器设备与所使用的 GitHub Pages 页面，避免安装来源不明的浏览器扩展。丢失密钥后可在 Zotero 官网撤销。

## 三、导入文献

1. 在 ChatGPT / GPT Work 中提出研究问题，并要求按照下述 JSON 格式输出经过核实的论文。
2. 将 JSON 粘贴到网页，或存成 `.json` 文件再上传。
3. 点击 **解析并预览**，核对标题、DOI、作者、期刊、笔记等信息。
4. 选择一个 Zotero Collection（可留空）、可选的附加标签。
5. 点击 **检查重复并导入**，再次确认。网页会逐篇显示写入结果，支持导出结果 JSON。
6. 若使用 Zotero 桌面版，打开它并同步，即可查看新条目和笔记。

### JSON 格式

```json
{
  "papers": [
    {
      "title": "Verified article title",
      "doi": "10.1234/verified-example",
      "authors": [
        {"firstName":"Jane", "lastName":"Smith"},
        {"firstName":"Wei", "lastName":"Zhang"}
      ],
      "year": 2025,
      "journal": "Journal Name",
      "volume": "12",
      "issue": "3",
      "pages": "101-115",
      "url": "https://doi.org/10.1234/verified-example",
      "abstract": "Abstract text, if verified.",
      "tags": ["AI-reviewed-pending", "microbiome"],
      "note": "Research question: ...\n\nMethods: ...\n\nFindings: ...\n\nLimitations: ..."
    }
  ]
}
```

以上仅为**格式示例**，DOI 和文献标题是占位符，不是真实文献。不要把占位符当作科研引用。

字段说明：

| 字段 | 说明 |
|---|---|
| `title` | **必填**，文献标题 |
| `doi` / `DOI` | 可选；有则按 DOI 优先检查重复；格式必须是 `10.xxxx/xxxx` |
| `authors` / `creators` | 作者，字符串数组或 `{firstName,lastName}` 对象数组 |
| `year` / `date` | 年份或日期 |
| `journal` / `publicationTitle` | 期刊名称 |
| `volume`, `issue`, `pages` | 卷、期、页码 |
| `url`, `abstract` / `abstractNote` | 链接与摘要 |
| `tags` | 字符串数组或逗号分隔字符串 |
| `note` / `notes` | 要附在论文下面的文字笔记；支持字符串、数组或对象，会转为安全文本 |

**关于作者**：为了准确生成 Zotero 引用，优先让 GPT 输出 `{ "firstName": "Jane", "lastName": "Smith" }`。对于字符串作者名（如 `Jane Smith`），工具会保留为 Zotero 的单字段姓名，以避免错误猜测姓氏；这种格式可能影响参考文献排版。

当前仅创建 `journalArticle`，不支持把书籍、学位论文自动识别成其他条目类型。

### 重复文献处理

- **默认**：相同 DOI 或标准化标题的已有论文**完全跳过**，不写入新条目或笔记。
- 勾选“已有相同 DOI / 标题时，仅追加笔记”：保留 Zotero 的已有论文条目，只创建新的子笔记；**重复执行可能产生重复笔记**。
- 同一批 JSON 内重复的论文自动跳过。
- 去重对比依赖 Zotero 已有记录的 DOI / 标题质量；无法解决拼写错误、不同版本预印本、极少数 DOI 别名等所有情况。
- 为保证检查完整，导入前需要逐页读取整个**个人文献库顶层条目**；大型文献库可能需要一些时间。
- Zotero 仍可能因云端并发修改、网络错误等出现部分成功/部分失败。请逐项核对结果后再考虑重新导入。

### 笔记

`note` 会保存为该文献的 Zotero **子笔记**，对原文进行 HTML 转义，不会把外部 HTML/脚本当作网页代码执行。内容保留段落和换行，但**不渲染 Markdown 格式**，如 `**bold**` 将作为普通文字显示。

## 四、常见问题

**连接失败（HTTP 403）**：检查数字 User ID、密钥是否正确、是否允许读取个人文献库。读取成功但 POST 失败，重点检查**写入权限**。

**浏览器显示网络请求失败**：确保通过 GitHub Pages 的 HTTPS URL 访问，检查网络、浏览器安全扩展和公司/学校网络限制。Zotero 的 Web Library 本身使用跨域（CORS）请求；若其服务端或浏览器限制发生变化，可能需要检查官方文档。

**为什么不能自动存储 PDF？**：PDF 上传涉及文件获取和 Zotero 附件上传流程，当前版本故意限制为文献元数据与文字笔记，降低复杂度与误操作风险。

**API Key 会公开吗？**：不会包含在 GitHub 仓库或网页源代码中。运行时密钥保存在当前标签页的 JS 内存中，并作为 HTTPS 请求头发送给 Zotero。输入前应检查你打开的确实是自己上传的网页地址。如果你额外添加第三方脚本，安全保证可能不再成立。

**如何让 GPT Work 直接点击导入？**：这个网站提供人工审核后的 JSON 导入流程，并**没有自动连接 GPT Work**。要让 AI 直接调用 Zotero，需要另行配置支持写入的工具/连接器。

**测试时会创建什么？**：点击“载入示例”只在网页预览一个标注为 `TEST` 的假论文。只有你连接账户并确认导入，才会在 Zotero 云端实际创建它。测试后请手动删除。

## API 与源代码参考

- [Zotero Web API v3](https://www.zotero.org/support/dev/web_api/v3/start)
- [Zotero Web API – Basics](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Zotero Web API – Write Requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
- [Zotero 的跨域 Web Library](https://github.com/zotero/web-library)

## License

MIT — see `LICENSE`.
