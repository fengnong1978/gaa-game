# 情景对话游戏引擎 — 开发交接文档（仓库内修订版）

> 面向接续开发的程序员。合并了原交接要点与 **2026 年初次大修** 后的实际代码状态；新会话可直接把本文件 + 具体任务交给助手。

---

## 1. 项目定位

纯前端浏览器剧情引擎：

| 页面 | 文件 | 说明 |
|------|------|------|
| 正式游玩 | `index.html` | 加载项目 JSON |
| 调试游玩 | `index_debug.html` | 注入 `debug-runtime.js` |
| 编辑器 | `editor.html` | 场景 / 步骤 / 人物 / 资源 |

**不要用 `file://` 打开。** 用本地 HTTP（如 `http://127.0.0.1`），否则文件系统 API、`DirectoryMemory`、上次打开项目等会受限。

---

## 2. 核心文件（按阅读顺序）

| 文件 | 职责 |
|------|------|
| `main.js` | 运行入口、加载 JSON |
| `scene-manager.js` | 场景跳转、步骤推进、随机分支、CG 会话 |
| `ui-manager.js` | 对话框、选项、步骤 CG |
| `renderer.js` | 背景 / 立绘渲染 |
| `effects.js` | 场景/步骤特效、BGM、音效 |
| `state.js` | 变量、角色属性、条件与 `effects` 应用、出现值变量 |
| `asset-manager.js` | 资源库 + 项目内嵌快照 |
| `storage-manager.js` | 项目导入导出、资源库 localStorage |
| `directory-memory.js` | IndexedDB 存目录句柄 / 项目根 / 上次打开的文件句柄 |
| `editor.js` | **巨型单文件**：编辑器全部逻辑 |
| `editor.html` / `editor.css` | 编辑器结构与样式 |

技术债：`editor.js` 体量极大，后续可拆模块（参考下文「后续建议章节」）。

---

## 3. 数据模型要点

- **项目**：`projectName`、`scenes[]`、`characterRoster[]`、`unifiedAttributes[]`、`relationAttributes`、`buildConfig`、`embeddedAssetLibrary`
- **场景**：`id`、`name`、`background`、`music`、`effects`、`steps[]`、**`appearedValue`**（0/1，运行时自动维护）
- **步骤**：`id`、`type`、`effects`、`labelSuffix`、`dramaticEffect`、`soundAlias`、**`appearedValue`**（0/1，运行时自动维护）、`stepFx`（步骤特效音效配置）等

`next`：`scene` / `label` / `ending`（见原交接文档或代码内用法）。

---

## 4. 近期已实现的编辑器改动（摘要）

### 4.1 左侧栏与「首页」

- 原顶部工具条已收掉可见条；**项目名** `current-project-name` 目前隐藏不占位。
- **左侧场景栏**内集中：
  - 第一行：`新建` `打开` **`上次`** `导出` `绑定`
  - 第二行：`调试` `剧情` `人物` `资源`
  - 搜索场景 + `搜索` 按钮
  - 列表头：`新增` `收起`；**收起后** 仅显示 `打开`（展开侧栏），**不显示新增**。
- **「上次」**：依赖 `showOpenFilePicker` + `DirectoryMemory.saveStartInHandle('picker:project-load', handle)`。若环境退回传统 `<input type=file>`，**不会**留下句柄，需先用「打开」在支持 API 的浏览器中选一次 JSON。
- **剧情 / 人物 / 资源**：使用 `class="tab"`，**已与普通按钮同色**（去掉蓝色 active 高亮）；逻辑仍用 `switchTab` + `active` class。
- **人物预设、资源库** 页顶有 **返回** → 回到 `story`。
- 人物预设页：已删除两段长说明文字；保留搜索、人物下拉、统一属性 / 新建人物等。

### 4.2 步骤与 CG

- **复制本步 / 复制上步**：对白、旁白、随机、**CG**、**选项** 均支持；复制后 **`labelSuffix` 清空**。
- **取消标签**：步骤头部有「取消标签」。
- **CG 步骤**（约三行紧凑布局，具体以 `editor.js` `renderSteps` 为准）：
  - 第 2 行：媒体 `选择素材`（含 `无`）、视频循环默认 **开**（`cgLoop` 缺省视为 true，迁移时补齐）。
  - 第 3 行：`CG音乐`（注意文案已从「CG 专属音乐」改为 **`CG音乐`**）、音乐含 `无`、音乐循环按钮等。
  - 停止点下拉首项文案固定为 **「默认」**（无解释性长句）。
  - 第一行：`拖拽 #CG` 与 `#序号 · CG` 等见当前 `makeHead` 实现。
- **步骤特效音效**：独立全页 `view-step-fx`（非小弹窗），便于长下拉。

### 4.3 人物值 / 条件

- **关系好感**：「人物」下拉仅 **在人物预设里配置过关系来源** 的角色；目标仅预设里已有条目。
- **出现值**：编辑里可在 `effects` 与随机条件中用 `kind: 'appearance'` / `type: 'appearance'`（与 `scene-manager.js` `evalCondition`、`state.js` `applyEffects` 一致）。**编辑器 UI 不展示步骤/场景的出现值数字**（避免与运行时混淆）。
- 运行时：`scene-manager.js` 进入场景/步骤时把 `appearedValue` 置 1，并 `GameState.markSceneAppeared` / `markStepAppeared`（同步 `variables` 里 `scene_seen_*` / `step_seen_*`）。

### 4.4 资源库

- 每类卡片：说明 **注册后目录** `assets/<子目录>/`。
- **已注册资源**：折叠按钮展开列表。
- **检查并清理失效资源**：校验磁盘路径存在性；确认后 **从库移除 + 清空项目内所有引用**（见 `Editor._clearReferencesForRemovedAsset`）。
- **全局字号**：`editor.css` 中 body / 控件基础约 12px（与早先「对齐删除按钮」约定一致，后续可调）。

---

## 5. 运行时与调试

- `index_debug.html`：可看 `GameState.variables`、`characters`、`debugLog` 等。
- **出现值**：除对象字段外，也可查 `scene_seen_<sceneId>`、`step_seen_<stepId>`。

---

## 6. 已知限制与注意事项

1. **「上次」项目**：仅当「打开」走 File System Access API 时可靠；`file://` 或陈旧浏览器可能无效。
2. **资源清理**：仅对 **库内 `path` 指向 `assets/...` 且能访问项目根** 的条目做强校验；DataURL 存库的不走磁盘探测。
3. **`editor.js` 单文件**：改步骤 UI 时在 `renderSteps` 附近搜索 `step.type === 'cg'` 等，避免重复逻辑。

---

## 7. 建议的后续工作

- 将 `editor.js` 拆为 `step-editor.js`、`scene-editor.js`、`asset-ui.js` 等。
- 给资源引用做导出前校验（别名是否存在）。
- 为 `SceneManager` / `GameState.applyEffects` 增加最小回归用例（手工清单亦可）。

---

## 8. 快速验证清单（接手后）

1. `http://127.0.0.1` 打开 `editor.html`，绑定项目根，新建 / 打开 / 上次 / 导出。
2. 剧情页：步骤复制、CG 三行布局、特效音效全页。
3. 人物预设：搜索、单人物编辑、关系好感。
4. 资源库：注册路径说明、失效检查清理（备份后试）。
5. `index_debug.html`：跑几步，确认出现值变量变化。

---

*文档生成自仓库当前状态；若你本地另有旧版 `PROJECT_HANDOVER.md`，以本仓库根目录 `PROJECT_HANDOVER.md` 为准延续开发。*
