/*
 * ============================================================================
 * 预设助手 · 预设脚本 v3.1.1
 * （前身为「剧情编年史」，v3.1 起更名「预设助手」）
 * ============================================================================
 *
 * 本文件是代码主体，托管在 https://github.com/haodayizhiyu404/yushe
 * 平时不需要手动维护本文件——酒馆助手的预设脚本库里只需粘贴 loader.js，
 * 每次打开页面会自动从仓库拉取最新版本执行（拉取失败用本地缓存兜底）。
 *
 * v3.1.1 修正：
 *   - 设置页文本框被 flex 布局压缩成不足一行：tab 子项禁止压缩
 *   - 讨论气泡上下大空白：pre-wrap 从气泡容器挪到文字层（结构空白不再渲染）
 *   - 气泡操作改为下方操作行（⟳ 重roll / 🗑 删除），悬停显现
 *
 * v3.1 更新：
 *   - 更名「预设助手」（按钮 + 面板标题）
 *   - 视觉重做：纸张感浅色阅读主题（米白底暖灰字、行距宽松），附日/夜切换，
 *     选择存全局变量；修掉酒馆全局样式覆盖导致的白输入框/文本框高度异常
 *   - 讨论气泡去掉名字标识（左右+颜色区分），✕/⟳ 挪到气泡外侧悬停显现，
 *     删除加二次确认
 *   - 设置页改为全部自动保存，仅保留「恢复默认」按钮
 *
 * v3.0 更新：
 *   - UI 重做：三个按钮合并为一个，单面板 + 左侧导航（总结/规划/切换/设置）
 *   - 分发方式改为仓库 + 加载器
 *
 * 设计理念（v2 起）：
 *   本脚本不自己拼装上下文——预设的 chatHistory / 世界书 / 角色卡占位符
 *   天然携带全部上下文。脚本只做三件事：
 *     1. 临时点亮预设里的「大总结」提示词条目
 *     2. 调 generate() 并在末尾追加一条 user 触发消息（如「生成大总结」）
 *     3. 把结果存入聊天变量、注入聊天顶部、隐藏已总结楼层
 *
 * 使用前提（预设作者负责）：
 *   预设里需要有两个默认关闭的提示词条目：
 *   1. 总结条目（如「📢大总结」），内容写明触发前提，例如：
 *        当User发送“生成大总结”或“总结前文”时，暂停正文叙事，只输出大总结。
 *   2. 规划条目（如「🧭剧情规划」），内容写明策划人设与输出契约（正式走向
 *      方案必须包在 <剧情走向> 标签里）。
 *   条目的 ID 或名称需与设置中的对应项一致。
 *
 * 数据存储：
 *   - 设置项   → 存在【预设变量】里，随预设导出，换聊天不丢
 *   - API 配置 → 存在【全局变量】里，只保存在当前用户本地，不随预设导出
 *   - 大总结   → 存在【聊天变量】里，跟着当前聊天存档走，开新档自动归零
 * ============================================================================
 */

$(() => {
    const VERSION = '3.1.1';
    const SCRIPT_ID = 'preset-novel-summarizer';
    const BUTTON_NAME = '🧰 预设助手';

    // ============================== 默认设置 ==============================
    // 设置保存在预设变量中，这里只是首次使用时的默认值
    const DEFAULT_SETTINGS = {
        entryKey: '📢大总结',               // 预设中总结条目的 ID 或名称
        plannerEntryKey: '🧭剧情规划',       // 预设中剧情规划条目的 ID 或名称
        triggerPrompt: '生成大总结',         // 总结时作为最后一条 user 消息发送的触发词
        keepRecent: 10,                     // 保留最近 N 条消息不总结（0 = 全部总结）
        maxBatchSize: 200,                  // 单次最多总结楼层数（积压量大时分批，减轻单次生成压力）
        injectionLabel: '历史剧情',          // 注入大总结时的开头标签
        hideAfterSummary: true,             // 总结后隐藏已总结楼层
        // 剧情催化的风格快捷提案按钮（一行一个，可在设置中编辑）
        plannerStyles: ['激烈冲突', '情感折磨', '宿命感', '事业成长'],
        // 走向模块的标签名（需与预设规划条目里输出契约的标签一致）
        outlineTag: '剧情走向',
        // 风格按钮点下去发送的提案模板，{{风格}} 会被替换为点选的风格名
        proposalTemplate: '请基于当前剧情现状，设计一个打破平淡的意外展开，风格偏向【{{风格}}】。以剧情趣味性为第一要素，时间尺度由题材自行决定，不必拘泥于现实时长。事件要具体可演、有连锁反应、能引入新张力，但不摧毁现有关系基础。',
        // 快速切换面板的互斥选项组（可在设置中编辑：组名 | 选项名 = 条目1, 条目2）
        switchRules: [
            { group: '破限', label: '常规', entries: ['◈==破限越狱==◈'] },
            { group: '破限', label: 'Lumi', entries: ['🌟拟人', '🌠故事法则'] },
        ],
    };

    // ============================ 存储读写 ============================

    /** 设置 → 预设变量（随预设导出） */
    function loadSettings() {
        const saved = getVariables({ type: 'preset' })[SCRIPT_ID] || {};
        return { ...DEFAULT_SETTINGS, ...saved };
    }
    function saveSettings(settings) {
        insertOrAssignVariables({ [SCRIPT_ID]: settings }, { type: 'preset' });
    }

    /** API 配置 → 全局变量（只存在当前用户本地，不随预设导出！） */
    const DEFAULT_API = {
        useCustomApi: false,
        customBaseUrl: '',
        customApiKey: '',
        customModel: '',
    };
    function loadApiConfig() {
        const saved = getVariables({ type: 'global' })[`${SCRIPT_ID}_api`] || {};
        return { ...DEFAULT_API, ...saved };
    }
    function saveApiConfig(api) {
        insertOrAssignVariables({ [`${SCRIPT_ID}_api`]: api }, { type: 'global' });
    }

    /** 面板主题（light/dark） → 全局变量（跟随用户本地，不随预设导出） */
    function loadTheme() {
        return getVariables({ type: 'global' })[`${SCRIPT_ID}_theme`] === 'dark' ? 'dark' : 'light';
    }
    function saveTheme(theme) {
        insertOrAssignVariables({ [`${SCRIPT_ID}_theme`]: theme }, { type: 'global' });
    }

    /** 大总结与进度 → 聊天变量（跟着聊天存档走） */
    function getChatData() {
        const data = getVariables({ type: 'chat' })[SCRIPT_ID];
        return {
            bigSummary: '',
            lastSummarizedMessageIndex: -1,
            history: [],
            planningHistory: [],            // 剧情规划讨论记录 [{role, content}]
            outline: '',                    // 当前生效的近期走向（剧情催化，演完即弃）
            ...data,
        };
    }
    function saveChatData(data) {
        insertOrAssignVariables({ [SCRIPT_ID]: data }, { type: 'chat' });
    }

    // ============================ 工具函数 ============================

    /**
     * 剥除思维链类标签内容（<think>/<thinking>/<cot>，大小写不敏感）。
     * 先剥成对标签；若剥完为空（标签未闭合等情况），再从第一个标签头截断兜底。
     */
    function cleanChainOfThought(text) {
        const raw = String(text || '');
        let cleaned = raw.replace(/<(think|thinking|cot)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
        if (!cleaned) {
            cleaned = raw.replace(/<(think|thinking|cot)\b[^>]*>[\s\S]*$/i, '').trim();
        }
        return cleaned || raw.trim();
    }

    /** 大总结注入到聊天记录顶部（in_chat, depth 9999） */
    function injectSummary() {
        const settings = loadSettings();
        const data = getChatData();
        const context = SillyTavern.getContext();
        const label = (settings.injectionLabel || '历史剧情').trim();
        const content = data.bigSummary ? `${label}\n${data.bigSummary}` : '';
        context.setExtensionPrompt(SCRIPT_ID, content, 1, 9999, false, 0);
    }

    /** 近期走向注入到 depth 0 规则层（靠近最新楼层，强引导；演完即弃的催化剂，不是长期主线） */
    function injectOutline() {
        const data = getChatData();
        const context = SillyTavern.getContext();
        const content = (data.outline || '').trim()
            ? `近期剧情走向（以下是作者与剧情策划确定的近期展开方向，请在叙事中自然融入、逐步推进，不要生硬照搬；该走向演完后即不再提及，它不是必须死守的长期主线）\n${data.outline.trim()}`
            : '';
        context.setExtensionPrompt(`${SCRIPT_ID}_outline`, content, 1, 0, false, 0);
    }

    function injectAll() {
        injectSummary();
        injectOutline();
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getStatusLine() {
        const data = getChatData();
        const total = getChatMessages('0-{{lastMessageId}}', { hide_state: 'all' }).length;
        const summaryLen = (data.bigSummary || '').length;
        let status = data.lastSummarizedMessageIndex < 0
            ? `当前未总结 · 总消息 ${total}`
            : `已总结到 #${data.lastSummarizedMessageIndex} · 总消息 ${total}`;
        status += ` · 大总结 ${summaryLen} 字符`;
        return status;
    }

    /** 在预设中查找提示词条目（按 ID 或名称匹配） */
    function findPromptEntry(preset, entryKey) {
        return preset.prompts.find(p => p.id === entryKey || p.name === entryKey);
    }

    /** 设置指定条目的启用状态 */
    async function setEntryEnabled(entryKey, enabled) {
        await updatePresetWith('in_use', preset => {
            const entry = findPromptEntry(preset, entryKey);
            if (entry) entry.enabled = enabled;
            return preset;
        });
    }

    /** 把一组楼层 id 压缩成连续区间，如 [1,2,3,5,7,8] → ['1-3','5','7-8'] */
    function compressIdRanges(ids) {
        const sorted = [...ids].sort((a, b) => a - b);
        const ranges = [];
        let start = null, prev = null;
        for (const id of sorted) {
            if (start === null) { start = prev = id; continue; }
            if (id === prev + 1) { prev = id; continue; }
            ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
            start = prev = id;
        }
        if (start !== null) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        return ranges;
    }

    // ============================ 快速切换配置解析 ============================

    /** 解析「组名 | 选项名 = 条目1, 条目2」文本为规则数组（忽略空行和格式错误的行） */
    function parseSwitchRules(text) {
        const rules = [];
        for (const line of String(text || '').split('\n')) {
            const m = line.trim().match(/^(.+?)\s*[|｜]\s*(.+?)\s*[=＝]\s*(.+)$/);
            if (!m) continue;
            rules.push({
                group: m[1].trim(),
                label: m[2].trim(),
                entries: m[3].split(/[,，]/).map(s => s.trim()).filter(Boolean),
            });
        }
        return rules;
    }

    /** 规则数组转回可编辑文本 */
    function formatSwitchRules(rules) {
        return (rules || []).map(r => `${r.group} | ${r.label} = ${r.entries.join(', ')}`).join('\n');
    }

    // ============================ 核心：总结 ============================

    let isSummarizing = false;

    async function runSummarization() {
        if (isSummarizing) {
            toastr.warning('正在总结中，请稍后再试');
            return;
        }
        const settings = loadSettings();
        const apiConfig = loadApiConfig();
        const data = getChatData();

        // 前置检查：预设里必须有总结条目
        const preset = getPreset('in_use');
        const entry = findPromptEntry(preset, settings.entryKey);
        if (!entry) {
            toastr.error(`未在当前预设中找到总结条目「${settings.entryKey}」，请检查设置中的条目 ID/名称`);
            return;
        }

        const allMessages = getChatMessages('0-{{lastMessageId}}', { hide_state: 'all' });
        if (allMessages.length === 0) {
            toastr.warning('当前没有聊天记录');
            return;
        }

        // 本次被总结的范围 = 当前未隐藏楼层 - 保留的最近 N 条
        // （生成时预设的 chatHistory 天然只包含未隐藏楼层，与此一致）
        const visible = allMessages.filter(m => !m.is_hidden);
        const keepRecent = Math.max(0, Number(settings.keepRecent) || 0);
        const processable = visible.slice(0, Math.max(0, visible.length - keepRecent));

        if (processable.length === 0) {
            toastr.info('没有新的前文需要总结');
            return;
        }

        // 分批与临时隐藏：
        // - 本批 = 待总结范围中最早的 maxBatchSize 楼
        // - 凡不在本批内的可见楼层（含保留的最近 N 楼 + 超出批次的积压楼层）
        //   一律【临时隐藏】，确保生成的 chatHistory 只含本批内容——
        //   否则 AI 会把最近 N 楼也总结进去，而这 N 楼仍留在上下文里，造成重复。
        // 临时隐藏的 id 记录在内存中，finally 里精确恢复，不进任何持久状态。
        const batchSize = Math.max(1, Number(settings.maxBatchSize) || 200);
        const batch = processable.slice(0, batchSize);
        const isBatched = processable.length > batchSize;
        const batchIds = new Set(batch.map(m => m.message_id));
        const tempHiddenIds = visible.filter(m => !batchIds.has(m.message_id)).map(m => m.message_id);

        isSummarizing = true;
        const lastMsgId = batch[batch.length - 1].message_id;
        const wasEnabled = entry.enabled;
        toastr.info(isBatched
            ? `预设助手：积压 ${processable.length} 楼，本次先总结到 #${lastMsgId}（每批 ${batchSize} 楼）...`
            : `预设助手：正在生成大总结（将覆盖到 #${lastMsgId}）...`);

        try {
            // 临时隐藏本批之外的可见楼层（最近 N 楼保留区 + 超批积压），finally 中精确恢复
            for (const range of compressIdRanges(tempHiddenIds)) {
                await triggerSlash(`/hide ${range}`);
            }

            // 自定义 API（可选；max_tokens 不覆盖，由预设自己的配置决定）
            let customApi;
            if (apiConfig.useCustomApi) {
                const baseUrl = String(apiConfig.customBaseUrl || '').trim().replace(/\/$/, '');
                if (!baseUrl) throw new Error('未填写自定义 API Base URL');
                if (!apiConfig.customApiKey) throw new Error('未填写自定义 API Key');
                if (!apiConfig.customModel) throw new Error('未填写自定义模型名');
                customApi = {
                    apiurl: baseUrl,
                    key: String(apiConfig.customApiKey).trim(),
                    model: String(apiConfig.customModel).trim(),
                };
            }

            // 点亮总结条目 → 生成（预设原生管线：角色卡/世界书/聊天记录自动组装，
            // user_input 作为最后一条 user 消息触发条目里写好的总结前提）
            await setEntryEnabled(settings.entryKey, true);
            const result = await generate({
                user_input: settings.triggerPrompt || '生成大总结',
                should_silence: true,
                custom_api: customApi,
            });

            const summaryText = cleanChainOfThought(result);
            if (!summaryText) throw new Error('AI 返回了空总结');

            // 存档历史版本（最多 20 个），再写入新总结
            data.history.push({
                lastSummarizedMessageIndex: data.lastSummarizedMessageIndex,
                bigSummary: data.bigSummary,
                at: new Date().toISOString(),
            });
            if (data.history.length > 20) data.history = data.history.slice(-20);

            data.bigSummary = summaryText;
            data.lastSummarizedMessageIndex = lastMsgId;
            saveChatData(data);

            if (settings.hideAfterSummary) {
                await triggerSlash(`/hide 0-${lastMsgId}`);
            }

            injectSummary();
            const remaining = processable.length - batch.length;
            toastr.success(remaining > 0
                ? `预设助手：已总结到 #${lastMsgId}（${summaryText.length} 字符），还有 ${remaining} 楼积压，可再次点击「立即总结」`
                : `预设助手：已生成总结（覆盖到 #${lastMsgId}，${summaryText.length} 字符）`);
        } catch (err) {
            console.error(`[${SCRIPT_ID}] 总结失败`, err);
            toastr.error(`预设助手：总结失败 - ${err.message || err}`);
        } finally {
            // 无论成败：恢复临时隐藏的楼层 + 恢复总结条目原状态
            try {
                for (const range of compressIdRanges(tempHiddenIds)) {
                    await triggerSlash(`/unhide ${range}`);
                }
            } catch (e) {
                console.warn(`[${SCRIPT_ID}] 恢复临时隐藏楼层失败`, e);
            }
            try {
                await setEntryEnabled(settings.entryKey, wasEnabled);
            } catch (e) {
                console.warn(`[${SCRIPT_ID}] 恢复总结条目状态失败`, e);
            }
            isSummarizing = false;
        }
    }

    async function undoLast() {
        const data = getChatData();
        if (!data.history.length) {
            toastr.warning('没有可撤销的历史版本');
            return;
        }
        const checkpoint = data.history.pop();
        data.bigSummary = checkpoint.bigSummary;
        data.lastSummarizedMessageIndex = checkpoint.lastSummarizedMessageIndex;
        saveChatData(data);
        await triggerSlash(`/unhide ${checkpoint.lastSummarizedMessageIndex + 1}-{{lastMessageId}}`);
        injectSummary();
        toastr.success(`已撤销上次总结，恢复到 #0~#${checkpoint.lastSummarizedMessageIndex}`);
    }

    async function clearAll() {
        saveChatData({ bigSummary: '', lastSummarizedMessageIndex: -1, history: [] });
        await triggerSlash(`/unhide 0-{{lastMessageId}}`);
        injectSummary();
        toastr.success('已清空所有总结并恢复所有隐藏消息');
    }

    // ============================ 核心：剧情规划 ============================

    let isPlanning = false;

    /** 从策划回复中提取走向模块内容（<剧情走向>...</剧情走向>，标签名设置可改）；没有则返回空串 */
    function extractOutline(text, tag) {
        const t = (String(tag || '').trim() || '剧情走向').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 容错全角 ＜＞；注意不能用 \b——JS 的 \b 只认 [A-Za-z0-9_]，中文标签名后没有"单词边界"，永远匹配不上
        const normalized = String(text || '').replace(/＜/g, '<').replace(/＞/g, '>');
        const m = normalized.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}\\s*>`, 'i'));
        return m ? m[1].trim() : '';
    }

    /**
     * 针对讨论记录末尾的 user 消息生成一条策划回复。
     * 成功才推入 AI 回复；失败时 user 消息留在末尾，面板里点「重新生成」即可重试。
     */
    async function generatePlannerReply() {
        const settings = loadSettings();
        const data = getChatData();
        const last = data.planningHistory[data.planningHistory.length - 1];
        if (!last || last.role !== 'user') {
            toastr.warning('没有待回复的消息');
            return null;
        }

        const preset = getPreset('in_use');
        const entry = findPromptEntry(preset, settings.plannerEntryKey);
        if (!entry) {
            toastr.error(`未在当前预设中找到规划条目「${settings.plannerEntryKey}」，请先在预设中创建（默认关闭），或在设置中修改条目名`);
            return null;
        }

        // 完整讨论记录拼进 user_input；人设与输出契约都在预设规划条目里（临时点亮生效）
        const transcript = data.planningHistory
            .map(m => `${m.role === 'user' ? '作者' : '策划'}：${m.content}`)
            .join('\n\n');
        const userInput = `【剧情规划讨论记录】\n${transcript}`;

        const wasEnabled = entry.enabled;
        try {
            await setEntryEnabled(settings.plannerEntryKey, true);
            const reply = await generate({ user_input: userInput, should_silence: true });
            const replyText = cleanChainOfThought(reply);
            if (!replyText) throw new Error('AI 返回了空回复');

            data.planningHistory.push({ role: 'assistant', content: replyText });
            // 讨论记录最多保留 40 轮，防止无限膨胀
            if (data.planningHistory.length > 80) {
                data.planningHistory = data.planningHistory.slice(-80);
            }
            saveChatData(data);
            return replyText;
        } catch (err) {
            console.error(`[${SCRIPT_ID}] 规划讨论失败`, err);
            toastr.error(`剧情规划：生成失败 - ${err.message || err}（你的消息已保留，点「重新生成」可重试）`);
            return null;
        } finally {
            try { await setEntryEnabled(settings.plannerEntryKey, wasEnabled); } catch (e) { /* 忽略 */ }
        }
    }

    /** 发送一条新的讨论消息（先入记录），再生成策划回复 */
    async function sendPlannerMessage(text) {
        const data = getChatData();
        data.planningHistory.push({ role: 'user', content: text });
        if (data.planningHistory.length > 80) {
            data.planningHistory = data.planningHistory.slice(-80);
        }
        saveChatData(data);
        return await generatePlannerReply();
    }

    // ============================ UI：样式（日/夜双主题） ============================

    const YCH_STYLE_ID = 'ych-style';
    const YCH_CSS = `
.ych-overlay{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;
    background:rgba(50,45,35,.32);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
.ych-overlay[data-theme="dark"]{background:rgba(0,0,0,.5);}
.ych-panel{
    --bg:#f6f2ea;--surface:#fffdf7;--surface2:#efe9dc;
    --text:#45403a;--dim:#98917f;
    --border:rgba(80,70,50,.16);
    --accent:#6b8cae;--accent-soft:rgba(107,140,174,.13);--accent-line:rgba(107,140,174,.5);
    --danger:#bf6a63;--danger-soft:rgba(191,106,99,.1);
    --bubble-user:#dfe9f2;--bubble-ai:#fffdf7;
    --input-bg:#fffdf7;--input-text:#45403a;--placeholder:#b6ad9a;
    width:min(960px,94vw);height:min(700px,90vh);display:flex;flex-direction:column;border-radius:14px;overflow:hidden;
    background:var(--bg);color:var(--text);font-size:14px;line-height:1.6;font-family:inherit;text-align:left;
    border:1px solid var(--border);box-shadow:0 16px 50px rgba(40,35,25,.28);}
.ych-overlay[data-theme="dark"] .ych-panel{
    --bg:#272520;--surface:#312e27;--surface2:#3b372e;
    --text:#dcd5c6;--dim:#8d8675;
    --border:rgba(230,220,200,.13);
    --accent:#8aa8c8;--accent-soft:rgba(138,168,200,.15);--accent-line:rgba(138,168,200,.55);
    --danger:#cf8279;--danger-soft:rgba(207,130,121,.12);
    --bubble-user:#34404e;--bubble-ai:#312e27;
    --input-bg:#211f1a;--input-text:#dcd5c6;--placeholder:#6f695a;
    box-shadow:0 16px 50px rgba(0,0,0,.5);}
.ych-header{display:flex;align-items:center;gap:12px;padding:10px 16px;
    border-bottom:1px solid var(--border);background:var(--surface);}
.ych-title{font-weight:700;font-size:15px;white-space:nowrap;}
.ych-status{flex:1;text-align:center;color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ych-icon-btn{background:none;border:none;color:var(--text);font-size:15px;cursor:pointer;
    opacity:.55;padding:2px 8px;border-radius:6px;}
.ych-icon-btn:hover{opacity:1;background:var(--accent-soft);}
.ych-body{flex:1;display:flex;min-height:0;}
.ych-nav{width:110px;flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:12px 8px;
    border-right:1px solid var(--border);background:var(--surface);}
.ych-nav-item{padding:9px 12px;border-radius:9px;cursor:pointer;color:var(--dim);white-space:nowrap;
    transition:background .15s,color .15s;user-select:none;}
.ych-nav-item:hover{color:var(--text);background:var(--accent-soft);}
.ych-nav-item.ych-active{color:var(--text);background:var(--accent-soft);
    box-shadow:inset 2px 0 0 var(--accent);font-weight:600;}
.ych-content{flex:1;min-width:0;padding:16px 18px;display:flex;}
.ych-tab{flex:1;display:flex;flex-direction:column;gap:10px;min-width:0;height:100%;overflow-y:auto;padding-right:4px;}
/* 内容超出时容器自己滚动，子项禁止被 flex 压缩（否则 textarea 会被挤成不足一行） */
.ych-tab>*{flex-shrink:0;}
.ych-label{color:var(--dim);font-size:13px;}
.ych-dim{color:var(--dim);font-size:12px;line-height:1.6;}
.ych-hr{border:none;border-top:1px solid var(--border);margin:4px 0;width:100%;}
.ych-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
.ych-section-title{font-weight:700;margin-top:6px;}
/* 输入框：高优先级 + !important 压过酒馆全局样式（否则白底/高度异常） */
.ych-overlay .ych-panel input.ych-input,.ych-overlay .ych-panel textarea.ych-input{
    background:var(--input-bg) !important;color:var(--input-text) !important;
    border:1px solid var(--border) !important;border-radius:8px;padding:8px 12px;
    font-size:14px;font-family:inherit;outline:none;width:100%;box-sizing:border-box;
    line-height:1.6;box-shadow:none;}
.ych-overlay .ych-panel input.ych-input:focus,.ych-overlay .ych-panel textarea.ych-input:focus{
    border-color:var(--accent-line) !important;box-shadow:0 0 0 2px var(--accent-soft);}
.ych-overlay .ych-panel .ych-input::placeholder{color:var(--placeholder) !important;opacity:1;}
.ych-overlay .ych-panel textarea.ych-input{height:auto !important;resize:vertical;line-height:1.6;}
.ych-overlay .ych-panel textarea.ych-summary-text{flex:1;min-height:220px;line-height:1.85;padding:12px 14px;}
.ych-btn{background:var(--surface);border:1px solid var(--border);border-radius:8px;
    padding:6px 14px;color:var(--text);font-size:14px;cursor:pointer;white-space:nowrap;
    transition:background .15s,border-color .15s;font-family:inherit;}
.ych-btn:hover:not(:disabled){background:var(--surface2);}
.ych-btn:disabled{opacity:.4;cursor:default;}
.ych-btn-primary{background:var(--accent-soft);border-color:var(--accent-line);}
.ych-btn-primary:hover:not(:disabled){background:var(--accent-soft);border-color:var(--accent);
    box-shadow:0 1px 6px var(--accent-soft);}
.ych-btn-danger{color:var(--danger);border-color:var(--danger);}
.ych-btn-danger:hover:not(:disabled){background:var(--danger-soft);}
.ych-chip{padding:5px 14px;border-radius:999px;background:var(--surface);border:1px solid var(--border);
    color:var(--text);cursor:pointer;font-size:13px;white-space:nowrap;
    transition:background .15s,border-color .15s;font-family:inherit;}
.ych-chip:hover:not(:disabled){background:var(--surface2);}
.ych-chip:disabled{opacity:.4;cursor:default;}
.ych-chip-active{background:var(--accent-soft);border-color:var(--accent-line);font-weight:600;}
.ych-log{flex:1;min-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;
    padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--surface2);}
.ych-bubble{padding:8px 14px;border-radius:12px;line-height:1.7;font-size:14px;}
/* pre-wrap 只套在文字层：保留消息内的换行，又不把 HTML 结构空白渲染出来 */
.ych-bubble-text{white-space:pre-wrap;word-break:break-word;}
.ych-bubble-user{background:var(--bubble-user);}
.ych-bubble-ai{background:var(--bubble-ai);border:1px solid var(--border);}
/* 每条消息 = 气泡 + 下方操作行（常态淡显，悬停清晰） */
.ych-msg{display:flex;flex-direction:column;width:fit-content;max-width:85%;}
.ych-msg-user{align-self:flex-end;align-items:flex-end;}
.ych-msg-ai{align-self:flex-start;align-items:flex-start;}
.ych-msg-actions{display:flex;gap:12px;padding:3px 8px 0;font-size:12px;opacity:.3;transition:opacity .15s;}
.ych-msg:hover .ych-msg-actions{opacity:.85;}
.ych-msg-actions a{color:var(--dim);text-decoration:none;cursor:pointer;}
.ych-msg-actions a:hover{color:var(--text);}
.ych-check{display:flex;align-items:center;gap:6px;color:var(--text);cursor:pointer;font-size:14px;}
.ych-saved{font-size:12px;color:var(--accent);opacity:0;transition:opacity .3s;}
.ych-tab::-webkit-scrollbar,.ych-log::-webkit-scrollbar,.ych-content textarea::-webkit-scrollbar{width:8px;}
.ych-tab::-webkit-scrollbar-thumb,.ych-log::-webkit-scrollbar-thumb,.ych-content textarea::-webkit-scrollbar-thumb{
    background:var(--border);border-radius:4px;}
.ych-tab::-webkit-scrollbar-track,.ych-log::-webkit-scrollbar-track,.ych-content textarea::-webkit-scrollbar-track{background:transparent;}
`;

    function ensureStyle(doc) {
        if (doc.getElementById(YCH_STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = YCH_STYLE_ID;
        style.textContent = YCH_CSS;
        doc.head.appendChild(style);
    }

    // ============================ UI：主面板 ============================

    function openMainPanel() {
        const parentDoc = window.parent.document;
        $(parentDoc).find('.ych-overlay').remove();  // 防重复打开
        ensureStyle(parentDoc);

        const $overlay = $(`
            <div class="ych-overlay">
                <div class="ych-panel">
                    <div class="ych-header">
                        <div class="ych-title">🧰 预设助手 <span style="opacity:.4;font-weight:400;font-size:11px;">v${VERSION}</span></div>
                        <div class="ych-status"></div>
                        <button class="ych-icon-btn ych-theme-toggle" title="切换日/夜主题">🌙</button>
                        <button class="ych-icon-btn ych-close" title="关闭（Esc）">✕</button>
                    </div>
                    <div class="ych-body">
                        <div class="ych-nav">
                            <div class="ych-nav-item" data-tab="summary">📜 总结</div>
                            <div class="ych-nav-item" data-tab="planner">🧭 规划</div>
                            <div class="ych-nav-item" data-tab="switch">🔀 切换</div>
                            <div class="ych-nav-item" data-tab="settings">⚙️ 设置</div>
                        </div>
                        <div class="ych-content"></div>
                    </div>
                </div>
            </div>
        `);

        const $content = $overlay.find('.ych-content');
        const refreshHeader = () => $overlay.find('.ych-status').text(getStatusLine());

        // 日/夜主题（存全局变量，跟随用户本地）
        const applyTheme = (theme) => {
            $overlay.attr('data-theme', theme);
            $overlay.find('.ych-theme-toggle').text(theme === 'dark' ? '☀️' : '🌙');
        };
        applyTheme(loadTheme());
        $overlay.find('.ych-theme-toggle').on('click', () => {
            const next = $overlay.attr('data-theme') === 'dark' ? 'light' : 'dark';
            saveTheme(next);
            applyTheme(next);
        });

        // 离开标签页时的收尾（冲刷防抖保存计时器，防止未落盘的编辑丢失）
        let onLeave = null;
        const flushLeave = () => {
            if (onLeave) {
                try { onLeave(); } catch (e) { console.warn(`[${SCRIPT_ID}] 标签页收尾失败`, e); }
                onLeave = null;
            }
        };

        const renderers = {
            summary: renderSummaryTab,
            planner: renderPlannerTab,
            switch: renderSwitchTab,
            settings: renderSettingsTab,
        };

        function showTab(name) {
            flushLeave();
            $overlay.find('.ych-nav-item').removeClass('ych-active')
                .filter(`[data-tab="${name}"]`).addClass('ych-active');
            $content.empty();
            refreshHeader();
            const leave = renderers[name]($content, { refreshHeader, showTab });
            onLeave = typeof leave === 'function' ? leave : null;
        }

        $overlay.find('.ych-nav-item').on('click', function () {
            showTab($(this).data('tab'));
        });

        const close = () => {
            flushLeave();
            $(parentDoc).off('keydown.ych');
            $overlay.remove();
        };
        $overlay.find('.ych-close').on('click', close);
        $overlay.on('click', (e) => { if (e.target === $overlay[0]) close(); });
        $(parentDoc).on('keydown.ych', (e) => { if (e.key === 'Escape') close(); });

        $(parentDoc.body).append($overlay);
        showTab('summary');
    }

    // ============================ UI：总结页 ============================

    function renderSummaryTab($content, ctx) {
        const data = getChatData();
        const $tab = $(`
            <div class="ych-tab">
                <div class="ych-label">当前大总结（可手动编辑，停止输入 1 秒后自动保存并注入）：</div>
                <textarea class="ych-input ych-summary-text"></textarea>
                <div class="ych-row">
                    <button class="ych-btn ych-btn-primary ns-run">📝 立即总结</button>
                    <button class="ych-btn ns-redo">♻️ 重新总结</button>
                    <button class="ych-btn ns-undo">↩️ 撤销</button>
                    <button class="ych-btn ych-btn-danger ns-clear">🗑️ 清空</button>
                </div>
                <div class="ych-dim">总结时自动点亮预设里的总结条目，生成完成后恢复关闭；已总结楼层默认隐藏，撤销/清空可还原。</div>
            </div>
        `);
        $content.append($tab);

        const $text = $tab.find('.ych-summary-text');
        $text.val(data.bigSummary);

        // 大总结编辑：防抖自动保存（停止输入 1 秒后写入并重新注入）
        let saveTimer = null;
        const doSave = () => {
            const d = getChatData();
            d.bigSummary = $text.val();
            saveChatData(d);
            injectSummary();
        };
        const flushSave = () => {
            if (saveTimer === null) return;
            clearTimeout(saveTimer);
            saveTimer = null;
            doSave();
        };
        $text.on('input', () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                doSave();
                ctx.refreshHeader();
            }, 1000);
        });

        // 操作按钮执行前必须掐掉防抖保存计时器，否则旧文本可能在撤销/重做途中被写回
        const syncPanel = () => {
            clearTimeout(saveTimer);
            saveTimer = null;
            $text.val(getChatData().bigSummary);
            ctx.refreshHeader();
        };

        $tab.find('.ns-run').on('click', async () => {
            clearTimeout(saveTimer); saveTimer = null;
            await runSummarization();
            syncPanel();
        });
        $tab.find('.ns-redo').on('click', async () => {
            await undoLast();
            syncPanel();  // 先回退面板显示，再开始重新生成
            await runSummarization();
            syncPanel();
        });
        $tab.find('.ns-undo').on('click', async () => {
            await undoLast();
            syncPanel();
        });
        $tab.find('.ns-clear').on('click', async () => {
            if (!confirm('确定要清空所有总结吗？\n这会删除大总结、历史版本，并恢复所有被隐藏的消息。')) return;
            await clearAll();
            syncPanel();
        });

        // 打开时文本框滚回顶部
        const ta = $text[0];
        if (ta) { ta.scrollTop = 0; ta.setSelectionRange(0, 0); ta.blur(); }

        return flushSave;
    }

    // ============================ UI：规划页 ============================

    function renderPlannerTab($content, ctx) {
        const $tab = $(`
            <div class="ych-tab">
                <div class="ych-label">当前近期走向（注入 depth 0 规则层，可手动编辑，自动保存；演完即弃，不是长期主线）：</div>
                <textarea class="ych-input np-outline" rows="3" style="flex:0 0 auto;"></textarea>
                <div class="ych-row">
                    <button class="ych-btn ych-btn-primary np-adopt" title="从最近一条含走向模块的策划回复中提取标签内容，录入走向框（覆盖旧的）">📌 采纳走向</button>
                    <button class="ych-btn np-clear-outline" title="走向已上演，撤掉注入">✅ 已演完</button>
                </div>
                <hr class="ych-hr" />
                <div class="np-styles-wrap" style="display:flex;flex-direction:column;gap:6px;">
                    <div class="ych-label" style="margin:0;">🎲 快速提案（点一个风格，按设置里的提案模板发出方向指令）：</div>
                    <div class="ych-row np-styles"></div>
                </div>
                <div class="ych-label">规划讨论（悬停气泡可 ✕ 删除，最后一条策划回复可 ⟳ 重 roll）：</div>
                <div class="ych-log np-log"></div>
                <div style="display:flex;gap:8px;align-items:flex-end;">
                    <textarea class="ych-input np-input" rows="2" style="flex:1 1 auto;" placeholder="对提案不满意？在这里微调，比如「再激烈一点」「换一个方向」"></textarea>
                    <div style="display:flex;flex-direction:column;gap:5px;">
                        <button class="ych-btn ych-btn-primary np-send">💬 发送</button>
                        <button class="ych-btn np-clear-log" title="清空讨论记录（不影响走向）">🧹 清空讨论</button>
                    </div>
                </div>
            </div>
        `);
        $content.append($tab);

        const $log = $tab.find('.np-log');
        const $outline = $tab.find('.np-outline');
        const $input = $tab.find('.np-input');
        const $sendBtn = $tab.find('.np-send');
        const $styles = $tab.find('.np-styles');

        /** 发送键三态：有字=发新消息；空+末尾是user=重新生成；空+末尾是AI=置灰 */
        const updateSendState = () => {
            const hasText = $input.val().trim().length > 0;
            const hist = getChatData().planningHistory;
            const lastIsUser = hist.length > 0 && hist[hist.length - 1].role === 'user';
            $sendBtn.prop('disabled', isPlanning || (!hasText && !lastIsUser));
            $sendBtn.text(hasText ? '💬 发送' : (lastIsUser ? '♻️ 重新生成' : '💬 发送'));
        };

        /** 统一发送流程：有 text 发新消息，空 text 针对末尾 user 消息重新生成 */
        const doSend = async (text) => {
            if (isPlanning) {
                toastr.warning('策划正在思考中，请稍等');
                return;
            }
            isPlanning = true;
            $input.val('');
            $sendBtn.prop('disabled', true).text('思考中...');
            $styles.find('button').prop('disabled', true);
            try {
                const reply = text ? await sendPlannerMessage(text) : await generatePlannerReply();
                renderLog();
                if (reply) {
                    const tag = loadSettings().outlineTag;
                    if (!extractOutline(reply, tag)) {
                        toastr.info(`本次回复未检测到 <${tag || '剧情走向'}> 模块，无可采纳的走向；可继续讨论或 ⟳ 重 roll`);
                    }
                }
            } finally {
                isPlanning = false;
                $styles.find('button').prop('disabled', false);
                updateSendState();
            }
        };

        const renderLog = () => {
            const hist = getChatData().planningHistory;
            $log.empty();
            if (hist.length === 0) {
                $log.append('<div class="ych-dim">还没有讨论记录。点上面的风格按钮直接出一条提案，或自己描述想要的方向。</div>');
            }
            hist.forEach((m, idx) => {
                const isUser = m.role === 'user';
                const isLastAssistant = !isUser && idx === hist.length - 1;
                const $msg = $(`
                    <div class="ych-msg ${isUser ? 'ych-msg-user' : 'ych-msg-ai'}">
                        <div class="ych-bubble ${isUser ? 'ych-bubble-user' : 'ych-bubble-ai'}"><div class="ych-bubble-text">${escapeHtml(m.content)}</div></div>
                        <div class="ych-msg-actions">
                            ${isLastAssistant ? '<a href="javascript:;" class="np-reroll" title="删掉这条并重新生成">⟳ 重roll</a>' : ''}
                            <a href="javascript:;" class="np-del" title="删除这条记录">🗑 删除</a>
                        </div>
                    </div>
                `);
                $msg.find('.np-del').on('click', () => {
                    if (isPlanning) { toastr.warning('策划正在思考中，请稍等'); return; }
                    if (!confirm('删除这条讨论记录？')) return;
                    const d = getChatData();
                    d.planningHistory.splice(idx, 1);
                    saveChatData(d);
                    renderLog();
                    updateSendState();
                });
                if (isLastAssistant) {
                    $msg.find('.np-reroll').on('click', () => {
                        if (isPlanning) { toastr.warning('策划正在思考中，请稍等'); return; }
                        const d = getChatData();
                        d.planningHistory.pop();  // 删掉这条 AI 回复，末尾回到对应的 user 消息
                        saveChatData(d);
                        renderLog();
                        doSend('');  // 空发送 = 针对末尾 user 消息重新生成
                    });
                }
                $log.append($msg);
            });
            $log.scrollTop($log[0].scrollHeight);
        };

        $outline.val(getChatData().outline);
        renderLog();
        updateSendState();
        $input.on('input', updateSendState);

        // 风格快捷提案按钮（列表与提案模板都在设置中可编辑）
        const styles = loadSettings().plannerStyles || [];
        if (styles.length === 0) {
            $tab.find('.np-styles-wrap').hide();
        }
        for (const style of styles) {
            const $chip = $(`<button class="ych-chip">${escapeHtml(style)}</button>`);
            $chip.on('click', () => {
                const tpl = (loadSettings().proposalTemplate || '').trim() || DEFAULT_SETTINGS.proposalTemplate;
                doSend(tpl.split('{{风格}}').join(style));
            });
            $styles.append($chip);
        }

        // 走向编辑：防抖自动保存 + 重新注入
        let outlineSaveTimer = null;
        const doOutlineSave = () => {
            const d = getChatData();
            d.outline = $outline.val();
            saveChatData(d);
            injectOutline();
        };
        const flushOutline = () => {
            if (outlineSaveTimer === null) return;
            clearTimeout(outlineSaveTimer);
            outlineSaveTimer = null;
            doOutlineSave();
        };
        $outline.on('input', () => {
            clearTimeout(outlineSaveTimer);
            outlineSaveTimer = setTimeout(() => {
                outlineSaveTimer = null;
                doOutlineSave();
            }, 1000);
        });

        $tab.find('.np-adopt').on('click', () => {
            const settings = loadSettings();
            const tag = settings.outlineTag || '剧情走向';
            const hit = [...getChatData().planningHistory].reverse()
                .find(m => m.role === 'assistant' && extractOutline(m.content, tag));
            if (!hit) {
                toastr.warning(`没有可采纳的走向：讨论记录里还没出现过 <${tag}> 模块`);
                return;
            }
            $outline.val(extractOutline(hit.content, tag)).trigger('input');
            toastr.success('已采纳走向模块（覆盖旧走向，可继续编辑，自动保存）');
        });

        $tab.find('.np-clear-outline').on('click', () => {
            clearTimeout(outlineSaveTimer);
            outlineSaveTimer = null;
            const d = getChatData();
            d.outline = '';
            saveChatData(d);
            injectOutline();
            $outline.val('');
            toastr.success('近期走向已撤掉，正文不再携带');
        });

        $sendBtn.on('click', () => {
            doSend($input.val().trim());
        });

        $tab.find('.np-clear-log').on('click', () => {
            if (isPlanning) { toastr.warning('策划正在思考中，请稍等'); return; }
            if (!confirm('确定清空规划讨论记录吗？（近期走向不受影响）')) return;
            const d = getChatData();
            d.planningHistory = [];
            saveChatData(d);
            renderLog();
            updateSendState();
            toastr.success('讨论记录已清空');
        });

        return flushOutline;
    }

    // ============================ UI：切换页 ============================

    function renderSwitchTab($content, ctx) {
        const settings = loadSettings();
        const rules = Array.isArray(settings.switchRules) ? settings.switchRules : [];
        const $tab = $('<div class="ych-tab"></div>');
        $content.append($tab);

        if (rules.length === 0) {
            $tab.append('<div class="ych-dim">尚未配置切换选项。<br>请在「⚙️ 设置」里按此格式添加（一行一条）：<br><code>组名 | 选项名 = 条目1, 条目2</code></div>');
            return null;
        }

        const preset = getPreset('in_use');
        const match = key => preset.prompts.find(p => p.name === key || p.id === key);
        const isActive = rule => rule.entries.length > 0
            && rule.entries.every(k => { const e = match(k); return !!(e && e.enabled); });

        // 按组名归组，保持配置中的出现顺序
        const groups = new Map();
        for (const r of rules) {
            if (!groups.has(r.group)) groups.set(r.group, []);
            groups.get(r.group).push(r);
        }

        for (const [groupName, options] of groups) {
            const $group = $(`
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <div class="ych-section-title">${escapeHtml(groupName)}</div>
                    <div class="ych-row sw-options"></div>
                </div>
            `);
            const $options = $group.find('.sw-options');
            for (const rule of options) {
                const active = isActive(rule);
                const $chip = $(`<button class="ych-chip ${active ? 'ych-chip-active' : ''}">${active ? '✅ ' : ''}${escapeHtml(rule.label)}</button>`);
                $chip.attr('title', `条目：${rule.entries.join('、')}`);
                $chip.on('click', async () => {
                    const missing = rule.entries.filter(k => !match(k));
                    if (missing.length) {
                        toastr.error(`快速切换：预设中找不到条目 ${missing.map(k => `「${k}」`).join('、')}，请检查条目名是否被改动`);
                        return;
                    }
                    const disableKeys = options.filter(o => o !== rule).flatMap(o => o.entries);
                    await updatePresetWith('in_use', p => {
                        for (const e of p.prompts) {
                            if (disableKeys.includes(e.name) || disableKeys.includes(e.id)) e.enabled = false;
                            if (rule.entries.includes(e.name) || rule.entries.includes(e.id)) e.enabled = true;
                        }
                        return p;
                    });
                    toastr.success(`「${groupName}」已切换到「${rule.label}」\n如需长期保留此状态，请手动保存预设`);
                    ctx.showTab('switch');  // 重渲染刷新高亮
                });
                $options.append($chip);
            }
            $tab.append($group);
        }
        $tab.append('<div class="ych-dim">切换只影响当前会话的条目启用状态，手动保存预设后才会长期保留。选项组在「⚙️ 设置」中配置。</div>');
        return null;
    }

    // ============================ UI：设置页（全部自动保存） ============================

    function renderSettingsTab($content, ctx) {
        const settings = loadSettings();
        const apiConfig = loadApiConfig();

        const $tab = $(`
            <div class="ych-tab">
                <div class="ych-row" style="justify-content:space-between;">
                    <div class="ych-dim">所有改动停止输入 1 秒后自动保存，无需手动操作。</div>
                    <span class="ych-saved">✓ 已保存</span>
                </div>

                <div class="ych-section-title">总结</div>
                <div class="ych-label">总结条目 ID/名称（预设中那个默认关闭的总结提示词条目）：</div>
                <input class="ych-input ns-s-entry" type="text" />
                <div class="ych-label">触发词（总结时作为最后一条 user 消息发送）：</div>
                <input class="ych-input ns-s-trigger" type="text" />
                <div class="ych-row">
                    <div style="flex:1;min-width:180px;">
                        <div class="ych-label">保留最近 N 条不总结（0 = 全部）：</div>
                        <input class="ych-input ns-s-keep" type="number" min="0" />
                    </div>
                    <div style="flex:1;min-width:180px;">
                        <div class="ych-label">单次最多总结楼层数（分批）：</div>
                        <input class="ych-input ns-s-batch" type="number" min="1" />
                    </div>
                </div>
                <div class="ych-label">注入大总结时的开头标签：</div>
                <input class="ych-input ns-s-label" type="text" />
                <label class="ych-check"><input class="ns-s-hide" type="checkbox" /> 总结后隐藏已总结楼层</label>

                <hr class="ych-hr" />
                <div class="ych-section-title">剧情规划</div>
                <div class="ych-label">规划条目 ID/名称（剧情规划讨论用的提示词条目）：</div>
                <input class="ych-input ns-s-planner-entry" type="text" />
                <div class="ych-label">走向模块标签名（需与预设规划条目里输出契约的标签一致）：</div>
                <input class="ych-input ns-s-tag" type="text" />
                <div class="ych-label">催化风格列表（规划页的快捷提案按钮，一行一个）：</div>
                <textarea class="ych-input ns-s-styles" rows="4"></textarea>
                <div class="ych-label">风格提案模板（点风格按钮时发送，{{风格}} 会被替换为风格名）：</div>
                <textarea class="ych-input ns-s-template" rows="4"></textarea>

                <hr class="ych-hr" />
                <div class="ych-section-title">快速切换</div>
                <div class="ych-label">切换配置（一行一条：<code>组名 | 选项名 = 条目1, 条目2</code>，同组内选项互斥）：</div>
                <textarea class="ych-input ns-s-switch" rows="4"></textarea>

                <hr class="ych-hr" />
                <div class="ych-section-title">API（只存本地，不随预设导出）</div>
                <label class="ych-check"><input class="ns-s-customapi" type="checkbox" /> 使用自定义 OpenAI 兼容 API（不勾选则使用当前主模型）</label>
                <div class="ych-label">自定义 API Base URL：</div>
                <input class="ych-input ns-s-url" type="text" placeholder="https://your-api.com/v1" />
                <div class="ych-label">自定义 API Key：</div>
                <input class="ych-input ns-s-key" type="password" placeholder="sk-..." />
                <div class="ych-label">自定义模型名：</div>
                <input class="ych-input ns-s-model" type="text" />

                <hr class="ych-hr" />
                <div class="ych-row">
                    <button class="ych-btn ns-reset-settings">🔄 恢复默认设置</button>
                </div>
                <div class="ych-dim">设置保存在预设变量中（随预设导出），API 配置保存在全局变量中（只存本地）。</div>
            </div>
        `);
        $content.append($tab);

        // 填充当前值
        $tab.find('.ns-s-entry').val(settings.entryKey);
        $tab.find('.ns-s-planner-entry').val(settings.plannerEntryKey);
        $tab.find('.ns-s-trigger').val(settings.triggerPrompt);
        $tab.find('.ns-s-keep').val(settings.keepRecent);
        $tab.find('.ns-s-batch').val(settings.maxBatchSize);
        $tab.find('.ns-s-label').val(settings.injectionLabel);
        $tab.find('.ns-s-hide').prop('checked', settings.hideAfterSummary);
        $tab.find('.ns-s-styles').val((settings.plannerStyles || []).join('\n'));
        $tab.find('.ns-s-tag').val(settings.outlineTag);
        $tab.find('.ns-s-template').val(settings.proposalTemplate);
        $tab.find('.ns-s-switch').val(formatSwitchRules(settings.switchRules));
        $tab.find('.ns-s-customapi').prop('checked', apiConfig.useCustomApi);
        $tab.find('.ns-s-url').val(apiConfig.customBaseUrl);
        $tab.find('.ns-s-key').val(apiConfig.customApiKey);
        $tab.find('.ns-s-model').val(apiConfig.customModel);

        // 收集并保存（设置 → 预设变量；API → 全局变量）
        const collectAndSave = () => {
            const s = loadSettings();
            s.entryKey = $tab.find('.ns-s-entry').val().trim() || '📢大总结';
            s.plannerEntryKey = $tab.find('.ns-s-planner-entry').val().trim() || '🧭剧情规划';
            s.triggerPrompt = $tab.find('.ns-s-trigger').val().trim() || '生成大总结';
            s.keepRecent = Math.max(0, parseInt($tab.find('.ns-s-keep').val(), 10) || 0);
            s.maxBatchSize = Math.max(1, parseInt($tab.find('.ns-s-batch').val(), 10) || 200);
            s.injectionLabel = $tab.find('.ns-s-label').val().trim() || '历史剧情';
            s.hideAfterSummary = $tab.find('.ns-s-hide').prop('checked');
            s.plannerStyles = $tab.find('.ns-s-styles').val().split('\n').map(x => x.trim()).filter(Boolean);
            s.outlineTag = $tab.find('.ns-s-tag').val().trim() || '剧情走向';
            s.proposalTemplate = $tab.find('.ns-s-template').val().trim() || DEFAULT_SETTINGS.proposalTemplate;
            s.switchRules = parseSwitchRules($tab.find('.ns-s-switch').val());
            delete s.plannerContract;  // v2.10 曾短暂放进设置，已撤回预设条目，清理遗留字段
            saveSettings(s);
            saveApiConfig({
                useCustomApi: $tab.find('.ns-s-customapi').prop('checked'),
                customBaseUrl: $tab.find('.ns-s-url').val().trim(),
                customApiKey: $tab.find('.ns-s-key').val().trim(),
                customModel: $tab.find('.ns-s-model').val().trim(),
            });
            injectSummary();  // 注入标签可能变了，立即重新注入
        };

        // 防抖自动保存 + 「已保存」指示
        let saveTimer = null;
        let savedFlashTimer = null;
        const scheduleSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                collectAndSave();
                const $saved = $tab.find('.ych-saved');
                $saved.css('opacity', 1);
                clearTimeout(savedFlashTimer);
                savedFlashTimer = setTimeout(() => $saved.css('opacity', 0), 1500);
            }, 1000);
        };
        $tab.on('input', 'input.ych-input, textarea.ych-input', scheduleSave);
        $tab.on('change', 'input[type="checkbox"]', scheduleSave);

        $tab.find('.ns-reset-settings').on('click', () => {
            if (!confirm('确定要恢复默认设置吗？当前自定义设置会被覆盖。（API 配置不受影响）')) return;
            clearTimeout(saveTimer);
            saveTimer = null;
            saveSettings({ ...DEFAULT_SETTINGS });
            injectSummary();
            toastr.success('已恢复默认设置');
            ctx.showTab('settings');  // 重渲染显示默认值
        });

        // 离开设置页时冲刷未落盘的编辑
        return () => {
            if (saveTimer !== null) {
                clearTimeout(saveTimer);
                saveTimer = null;
                collectAndSave();
            }
        };
    }

    // ============================ 启动 ============================

    replaceScriptButtons([{ name: BUTTON_NAME, visible: true }]);
    eventOn(getButtonEvent(BUTTON_NAME), openMainPanel);
    eventOn(tavern_events.CHAT_CHANGED, () => injectAll());
    eventOn(tavern_events.GENERATION_AFTER_COMMANDS, () => injectAll());
    injectAll();

    console.log(`[${SCRIPT_ID}] 预设助手 v${VERSION} 已加载（当前预设：${getLoadedPresetName()}）`);
});
