/*
 * ============================================================================
 * 剧情编年史 · 加载器
 * ============================================================================
 * 代码主体托管在 https://github.com/haodayizhiyu404/yushe
 * 本加载器是唯一需要粘贴进酒馆助手「预设脚本库」的文件：
 *   每次打开页面时从仓库拉取最新 main.js 执行；
 *   拉取失败（断网 / GitHub 抽风）时自动回退到本地缓存版本。
 * 正常情况下本文件不需要改动。
 * ============================================================================
 */

$(async () => {
    const REMOTE_URL = 'https://raw.githubusercontent.com/haodayizhiyu404/yushe/main/main.js';
    const CACHE_KEY = 'yushe_main_cache';

    let code = null;
    try {
        const resp = await fetch(`${REMOTE_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        code = await resp.text();
        if (!code.includes('剧情编年史')) throw new Error('拉取到的内容异常');
        // 拉取成功：缓存进全局变量（只存本地），作为下次的兜底版本
        insertOrAssignVariables({ [CACHE_KEY]: code }, { type: 'global' });
    } catch (e) {
        console.warn('[yushe-loader] 远程拉取失败，尝试本地缓存', e);
        code = getVariables({ type: 'global' })[CACHE_KEY] || null;
        if (code) {
            toastr.warning('剧情编年史：远程拉取失败，已使用本地缓存版本');
        }
    }

    if (!code) {
        toastr.error('剧情编年史：加载失败（远程拉取失败且无本地缓存），请检查网络后刷新页面');
        return;
    }

    try {
        (0, eval)(code);
    } catch (e) {
        console.error('[yushe-loader] 脚本执行失败', e);
        toastr.error(`剧情编年史：脚本执行失败 - ${e.message || e}`);
    }
});
