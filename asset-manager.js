/**
 * asset-manager.js - 全局资源管理中心
 */
const AssetManager = {
    /** 编辑器资源库标签页要展示的分类（与 editor.js 标题一致） */
    editorAssetTypes: ['characters', 'backgrounds', 'storyGraphics', 'music', 'sounds', 'particles'],

    /** 当前项目 JSON 内嵌的资源（导出携带，运行/编辑加载时合并） */
    projectEmbedded: null,
    _warnedLibraryQuotaNoPersist: false,

    library: {
        characters: [],
        backgrounds: [],
        storyGraphics: [],
        sounds: [],
        music: [],
        particles: []
    },

    init() {
        this.library = StorageManager.loadLibrary();
    },

    clearProjectEmbedded() {
        this.projectEmbedded = null;
    },

    applyProjectEmbedded(embed) {
        if (!embed || typeof embed !== 'object') {
            this.projectEmbedded = null;
            return;
        }
        this.projectEmbedded = {
            characters: embed.characters || [],
            backgrounds: embed.backgrounds || [],
            storyGraphics: embed.storyGraphics || [],
            sounds: embed.sounds || [],
            music: embed.music || [],
            particles: embed.particles || []
        };
    },

    /**
     * 收集项目中实际用到的资源，用于写入 JSON（含 data URL 时任意环境可显示）
     */
    collectCharacterSpriteAliases(project) {
        const set = new Set();
        if (!project) return set;
        (project.characterRoster || []).forEach(c => {
            Object.values(c.expressions || {}).forEach(ex => {
                if (ex && ex.spriteAsset) set.add(ex.spriteAsset);
            });
        });
        (project.scenes || []).forEach(s => {
            if (s.character && s.character.url) set.add(s.character.url);
            const ro = (project.characterRoster || []).find(x => x.id === s.characterRef);
            if (ro && ro.expressions) {
                const key = s.expression || ro.defaultExpression || Object.keys(ro.expressions)[0];
                const slot = ro.expressions[key];
                if (slot && slot.spriteAsset) set.add(slot.spriteAsset);
            }
        });
        return set;
    },

    buildEmbeddedSnapshotForProject(project) {
        if (!project || !project.scenes) return null;
        const used = {
            characters: new Set(),
            backgrounds: new Set(),
            storyGraphics: new Set(),
            sounds: new Set(),
            music: new Set(),
            particles: new Set()
        };
        project.scenes.forEach(s => {
            if (s.background && s.background.url) used.backgrounds.add(s.background.url);
            if (s.storyGraphic && s.storyGraphic.url) used.storyGraphics.add(s.storyGraphic.url);
            if (s.music && s.music.url) used.music.add(s.music.url);
            (s.steps || []).forEach(st => {
                if (st && st.type === 'cg' && st.cgMusicAlias) used.music.add(st.cgMusicAlias);
                if (st && st.type === 'cg' && st.cg && st.cg.url) used.storyGraphics.add(st.cg.url);
            });
            const ef = s.effects || {};
            if (typeof StoryEffectsRegistry !== 'undefined' && StoryEffectsRegistry.collectParticleAliasesFromSceneEffects) {
                StoryEffectsRegistry.collectParticleAliasesFromSceneEffects(ef).forEach(a => used.particles.add(a));
            } else {
                const builtins = new Set([
                    'starryNight',
                    'goldenBokeh',
                    'softGlow',
                    'heartBubbles',
                    'rainFine',
                    'coldBlue'
                ]);
                (ef.overlays || []).forEach(id => {
                    if (id && !builtins.has(id)) used.particles.add(id);
                });
                if (ef.combo === 'combo_passionate') used.particles.add('樱花');
            }
            if (ef.dramatic) used.sounds.add(ef.dramatic);
        });
        this.collectCharacterSpriteAliases(project).forEach(a => used.characters.add(a));
        const out = {};
        let any = false;
        ['characters', 'backgrounds', 'storyGraphics', 'sounds', 'music', 'particles'].forEach(type => {
            const names = used[type];
            if (!names || !names.size) return;
            const list = [];
            names.forEach(name => {
                let asset = (this.library[type] || []).find(a => a.name === name);
                if (!asset && this.projectEmbedded && this.projectEmbedded[type]) {
                    asset = this.projectEmbedded[type].find(a => a.name === name);
                }
                if (asset) {
                    const row = { name: asset.name, path: asset.path || '' };
                    if (asset.src) row.src = asset.src;
                    list.push(row);
                    any = true;
                }
            });
            if (list.length) out[type] = list;
        });
        return any ? out : null;
    },

    registerAsset(type, name, path, src) {
        if (!this.library[type]) this.library[type] = [];
        const asset = { name, path };
        if (src) asset.src = src;
        const idx = this.library[type].findIndex(a => a.name === name);
        const oldAsset = idx >= 0 ? this.library[type][idx] : null;
        if (idx >= 0) this.library[type][idx] = asset;
        else this.library[type].push(asset);
        try {
            StorageManager.saveLibrary(this.library);
        } catch (err) {
            const quota = err && (err.name === 'QuotaExceededError' || err.code === 22);
            // 磁盘写入场景（src 为空）下，即便 localStorage 爆满，也保留内存中的资源登记，避免上传流程被 QUOTA 卡死
            if (quota && !src) {
                if (!this._warnedLibraryQuotaNoPersist) {
                    this._warnedLibraryQuotaNoPersist = true;
                    alert('浏览器本地缓存已满：资源已写入项目 assets 目录，但本地资源索引无法持久化。建议稍后清理站点存储。');
                }
                return;
            }
            if (idx >= 0 && oldAsset) this.library[type][idx] = oldAsset;
            else if (idx < 0) this.library[type] = this.library[type].filter(a => a.name !== name);
            if (quota) throw new Error('QUOTA');
            throw err;
        }
    },

    removeAsset(type, name) {
        if (!this.library[type]) return;
        this.library[type] = this.library[type].filter(a => a.name !== name);
        StorageManager.saveLibrary(this.library);
    },

    getPath(type, name) {
        if (!name) return null;
        if (this.projectEmbedded && this.projectEmbedded[type]) {
            const hit = this.projectEmbedded[type].find(a => a.name === name);
            if (hit && (hit.src || hit.path)) return hit.src || hit.path;
        }
        if (!this.library[type]) return null;
        const asset = this.library[type].find(a => a.name === name);
        if (!asset) return null;
        return asset.src || asset.path;
    },

    assetNameExists(type, name) {
        return (this.library[type] || []).some(a => a.name === name);
    },

    getList(type) {
        const seen = new Set();
        const out = [];
        (this.library[type] || []).forEach(a => {
            if (a.name && !seen.has(a.name)) {
                seen.add(a.name);
                out.push(a.name);
            }
        });
        if (this.projectEmbedded && this.projectEmbedded[type]) {
            this.projectEmbedded[type].forEach(a => {
                if (a.name && !seen.has(a.name)) {
                    seen.add(a.name);
                    out.push(a.name);
                }
            });
        }
        return out;
    }
};
