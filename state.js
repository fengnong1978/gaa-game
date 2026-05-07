/**
 * state.js - 游戏全局状态管理
 */
const GameState = {
    // 变量池：存储好感度、开关等
    variables: {
        player_name: "旅人",
        affection: 50,       // 初始好感度
        has_seen_letter: false // 是否看过信件
    },

    /** 调试/发布配置（调试页可改；发布模式会强制关闭固定种子） */
    runtimeConfig: {
        fixedSeed: false,
        seed: 12345,
        publishMode: false
    },

    _rng: null,
    debugLog: [],

    _log(type, detail) {
        try {
            this.debugLog.push({ t: Date.now(), type, detail });
            if (this.debugLog.length > 400) this.debugLog.splice(0, this.debugLog.length - 400);
        } catch {}
    },

    /** 角色属性（隐藏，不在游戏 UI 展示） */
    characters: {
        /** [charId]: { unified:{}, relations:{ [targetId]: { affection:number } } } */
    },

    clamp01_100(n) {
        const x = Number(n);
        if (!Number.isFinite(x)) return 0;
        return Math.max(0, Math.min(100, Math.round(x)));
    },

    /** Mulberry32 seeded rng */
    _makeRng(seed) {
        let a = (seed >>> 0) || 0x12345678;
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    },

    setSeed(seed) {
        this.runtimeConfig.seed = Number(seed) || 0;
        this._rng = this._makeRng(this.runtimeConfig.seed);
    },

    random() {
        if (this.runtimeConfig.publishMode) return Math.random();
        if (!this.runtimeConfig.fixedSeed) return Math.random();
        if (!this._rng) this.setSeed(this.runtimeConfig.seed);
        return this._rng();
    },

    /** 初始化角色属性：统一属性 + 关系属性 + 存在 */
    initCharacterState(project) {
        const roster = (project && project.characterRoster) || [];
        const unifiedDefs = (project && project.unifiedAttributes) || [];
        const relDefs = (project && project.relationAttributes) || {};
        const defaults = {};
        unifiedDefs.forEach(d => {
            if (!d || !d.key) return;
            defaults[d.key] = d.type === 'bool' ? !!d.default : Number(d.default) || 0;
        });
        // 系统保留统一属性：存在
        defaults['存在'] = true;

        roster.forEach(c => {
            const id = c.id;
            if (!id) return;
            const base = { unified: { ...defaults }, relations: {} };
            // 单角色覆盖统一初始值
            if (c.unifiedOverrides && typeof c.unifiedOverrides === 'object') {
                Object.keys(c.unifiedOverrides).forEach(k => {
                    base.unified[k] = c.unifiedOverrides[k];
                });
            }
            // 关系初始值（只做 affection）
            const map = relDefs[id] || {};
            Object.keys(map).forEach(targetId => {
                const row = map[targetId];
                const v = row && row.affection != null ? row.affection : 0;
                base.relations[targetId] = { affection: this.clamp01_100(v) };
            });
            this.characters[id] = base;
        });
    },

    getRelationAffection(fromId, toId) {
        const c = this.characters[fromId];
        if (!c || !c.relations || !c.relations[toId]) return 0;
        return this.clamp01_100(c.relations[toId].affection);
    },

    addRelationAffection(fromId, toId, delta) {
        if (!fromId || !toId || fromId === toId) return;
        if (!this.characters[fromId]) this.characters[fromId] = { unified: { 存在: true }, relations: {} };
        const c = this.characters[fromId];
        if (!c.relations[toId]) c.relations[toId] = { affection: 0 };
        const prev = this.clamp01_100(c.relations[toId].affection || 0);
        const next = this.clamp01_100(prev + (Number(delta) || 0));
        c.relations[toId].affection = next;
        this._log('relation', { from: fromId, to: toId, prev, next, delta: Number(delta) || 0 });
    },

    getUnified(charId, key) {
        const c = this.characters[charId];
        if (!c || !c.unified) return null;
        return c.unified[key];
    },

    setUnified(charId, key, val) {
        if (!charId || !key) return;
        if (!this.characters[charId]) this.characters[charId] = { unified: { 存在: true }, relations: {} };
        const prev = this.characters[charId].unified[key];
        this.characters[charId].unified[key] = val;
        this._log('unified', { charId, key, prev, next: val });
    },

    applyEffects(effects) {
        const list = Array.isArray(effects) ? effects : [];
        list.forEach(e => {
            if (!e || typeof e !== 'object') return;
            if (e.kind === 'var') {
                const cur = Number(this.get(e.var)) || 0;
                if (e.op === 'add') this.set(e.var, cur + (Number(e.val) || 0));
                else if (e.op === 'set') this.set(e.var, e.val);
                return;
            }
            if (e.kind === 'relation') {
                this.addRelationAffection(e.from, e.to, e.delta);
                return;
            }
            if (e.kind === 'unified') {
                if (e.op === 'set') this.setUnified(e.charId, e.key, e.val);
                else if (e.op === 'add') {
                    const cur = Number(this.getUnified(e.charId, e.key)) || 0;
                    this.setUnified(e.charId, e.key, cur + (Number(e.val) || 0));
                }
            }
        });
    },

    // 获取变量值
    get(key) {
        return this.variables[key];
    },

    // 设置变量值
    set(key, value) {
        this.variables[key] = value;
        console.log(`变量更新: ${key} = ${value}`);
        this._log('var', { key, value });
    },

    // 动态文本解析核心：处理 {if...else...} 和 {variable}
    parseText(text) {
        // 1. 处理 {if condition} text {else} text {endif}
        // 匹配模式: {if 变量 > 值} 文本A {else} 文本B {endif}
        const ifRegex = /\{if (.*?) ([\>\<\=]+) (.*?)\} (.*?) \{else\} (.*?) \{endif\}/g;
        let processedText = text.replace(ifRegex, (match, varName, op, value, trueText, falseText) => {
            const currentVal = this.get(varName);
            const targetVal = parseFloat(value);
            let conditionMet = false;

            if (op === '>') conditionMet = currentVal > targetVal;
            else if (op === '<') conditionMet = currentVal < targetVal;
            else if (op === '=') conditionMet = currentVal == targetVal;

            return conditionMet ? trueText : falseText;
        });

        // 2. 处理简单的变量替换 {player_name}
        const varRegex = /\{(.*?)\}/g;
        processedText = processedText.replace(varRegex, (match, varName) => {
            return this.get(varName) !== undefined ? this.get(varName) : match;
        });

        return processedText;
    }
};
