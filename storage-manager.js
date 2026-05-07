/**
 * storage-manager.js - 资源存取管理器 (增强版)
 */
const StorageManager = {
    // 1. 项目 JSON 的导入导出
    async loadProjectFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try { resolve(JSON.parse(e.target.result)); } 
                catch (err) { reject("JSON 格式错误"); }
            };
            reader.onerror = () => reject("文件读取失败");
            reader.readAsText(file);
        });
    },

    exportProject(data, opts = {}) {
        const embedded =
            typeof AssetManager !== 'undefined' && AssetManager.buildEmbeddedSnapshotForProject
                ? AssetManager.buildEmbeddedSnapshotForProject(data)
                : null;
        const payload = { ...data };
        const publishMode = !!opts.publishMode;
        payload.buildConfig = { ...(payload.buildConfig || {}), publishMode };
        if (embedded) payload.embeddedAssetLibrary = embedded;
        else delete payload.embeddedAssetLibrary;
        const blob = new Blob([JSON.stringify(payload, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'episode_exported.json';
        a.click();
        URL.revokeObjectURL(url);
    },

    validatePublishBundle(data) {
        const warnings = [];
        const embedded =
            typeof AssetManager !== 'undefined' && AssetManager.buildEmbeddedSnapshotForProject
                ? AssetManager.buildEmbeddedSnapshotForProject(data)
                : null;
        if (!embedded) {
            warnings.push('未收集到内嵌资源，发布包可能缺少图片/音频。');
            return warnings;
        }
        const countByType = ['characters', 'backgrounds', 'storyGraphics', 'sounds', 'music', 'particles']
            .map(t => ({ t, n: Array.isArray(embedded[t]) ? embedded[t].length : 0 }))
            .filter(x => x.n > 0);
        if (!countByType.length) warnings.push('资源清单为空，请检查是否已给步骤绑定资源。');
        return warnings;
    },

    exportPublishBundle(data, opts = {}) {
        const embedded =
            typeof AssetManager !== 'undefined' && AssetManager.buildEmbeddedSnapshotForProject
                ? AssetManager.buildEmbeddedSnapshotForProject(data)
                : null;
        const payload = { ...data };
        payload.buildConfig = { ...(payload.buildConfig || {}), publishMode: true };
        if (embedded) payload.embeddedAssetLibrary = embedded;
        else delete payload.embeddedAssetLibrary;

        const manifest = {
            packageType: 'storyengine-publish-bundle',
            version: 1,
            generatedAt: new Date().toISOString(),
            projectName: payload.projectName || '未命名项目',
            publishMode: true,
            resourceCounts: {
                characters: (embedded && embedded.characters && embedded.characters.length) || 0,
                backgrounds: (embedded && embedded.backgrounds && embedded.backgrounds.length) || 0,
                storyGraphics: (embedded && embedded.storyGraphics && embedded.storyGraphics.length) || 0,
                sounds: (embedded && embedded.sounds && embedded.sounds.length) || 0,
                music: (embedded && embedded.music && embedded.music.length) || 0,
                particles: (embedded && embedded.particles && embedded.particles.length) || 0
            },
            notes: [
                '该发布包为单文件 JSON，内含运行所需资源快照。',
                '将本文件与引擎运行页放在同目录，打开 index.html 后加载本文件即可。'
            ]
        };
        const out = {
            ...payload,
            bundleManifest: manifest
        };

        const blob = new Blob([JSON.stringify(out, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (opts.fileName || 'storyengine_publish_bundle.json').replace(/[\\/:*?"<>|]+/g, '_');
        a.click();
        URL.revokeObjectURL(url);
    },

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('读取失败'));
            reader.readAsDataURL(file);
        });
    },

    readImageAsResizedDataURL(file, maxEdge = 1920, quality = 0.88, mimeType = 'image/webp') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) return reject(new Error('图片尺寸无效'));
                    const scale = Math.min(1, maxEdge / Math.max(w, h));
                    const tw = Math.max(1, Math.round(w * scale));
                    const th = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = tw;
                    canvas.height = th;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('无法创建画布上下文'));
                    ctx.drawImage(img, 0, 0, tw, th);
                    try {
                        resolve(canvas.toDataURL(mimeType, quality));
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('图片解码失败'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error || new Error('读取失败'));
            reader.readAsDataURL(file);
        });
    },

    async buildImageCompressionCandidates(file) {
        const attempts = [];
        const plans = [
            { maxEdge: 2048, quality: 0.9, mimeType: 'image/webp' },
            { maxEdge: 1600, quality: 0.86, mimeType: 'image/webp' },
            { maxEdge: 1280, quality: 0.82, mimeType: 'image/webp' },
            { maxEdge: 1024, quality: 0.78, mimeType: 'image/webp' },
            { maxEdge: 768, quality: 0.72, mimeType: 'image/webp' }
        ];
        for (const plan of plans) {
            try {
                const dataUrl = await this.readImageAsResizedDataURL(file, plan.maxEdge, plan.quality, plan.mimeType);
                if (dataUrl && !attempts.includes(dataUrl)) attempts.push(dataUrl);
            } catch (err) {
                console.warn('压缩尝试失败', plan, err);
            }
        }
        return attempts;
    },

    // 2. 全局资源库的持久化 (存储在 LocalStorage)
    saveLibrary(libraryData) {
        localStorage.setItem('storyengine_asset_library', JSON.stringify(libraryData));
    },

    loadLibrary() {
        const defaults = {
            characters: [],
            backgrounds: [],
            storyGraphics: [],
            sounds: [],
            music: [],
            particles: []
        };
        const raw = localStorage.getItem('storyengine_asset_library');
        if (!raw) return { ...defaults };
        try {
            const parsed = JSON.parse(raw);
            return { ...defaults, ...parsed };
        } catch {
            return { ...defaults };
        }
    },

    // 3. 游戏进度的保存
    saveProgress(key, value) {
        localStorage.setItem(`storyengine_progress_${key}`, JSON.stringify(value));
    },

    loadProgress(key) {
        const data = localStorage.getItem(`storyengine_progress_${key}`);
        return data ? JSON.parse(data) : null;
    }
};
