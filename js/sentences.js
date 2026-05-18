/**
 * Typing-tier sentence banks for the spell-casting minigame.
 * Each tier has its own timer, score multiplier, and vocabulary level.
 *
 * Spell timers use per-cast limits from sentence length and tier target WPM
 * (words / WPM * 60 * comfort buffer), clamped per tier.
 *
 * Benchmark reference (user table):
 * | Category              | UI WPM    | Accuracy   |
 * | Grade 1–6             | 5–30      | 80–90%     |
 * | Grade 7–12            | 30–60     | 90–95%     |
 * | University / Academic | 50–70     | 95%+       |
 * | Work / Professionals  | 40–80+    | 95%+       |
 * | IELTS / TOEFL         | 30–40+    | High       |
 *
 * targetWpm uses the lower-quarter of each UI range:
 *   low + 0.25 * (high - low)  (rounded to integer for timers)
 */
(function (global) {
    "use strict";

    var TIER_STORAGE_KEY = "spelldungeon-typing-tier";
    var DEFAULT_TIER_ID = "grade-7-12";

    var TIER_TIMING = {
        "grade-1-6": {
            targetWpm: 11,
            buffer: 1.5,
            minSec: 14,
            maxSec: 28,
            wpmRangeLabel: "5–30 WPM",
            accuracyGoalMin: 80,
            accuracyGoalLabel: "80%+ acc",
        },
        "grade-7-12": {
            targetWpm: 38,
            buffer: 1.4,
            minSec: 10,
            maxSec: 18,
            wpmRangeLabel: "30–60 WPM",
            accuracyGoalMin: 90,
            accuracyGoalLabel: "90%+ acc",
        },
        work: {
            targetWpm: 50,
            buffer: 1.4,
            minSec: 9,
            maxSec: 16,
            wpmRangeLabel: "40–80+ WPM",
            accuracyGoalMin: 95,
            accuracyGoalLabel: "95%+ acc",
        },
        academic: {
            targetWpm: 55,
            buffer: 1.35,
            minSec: 8,
            maxSec: 13,
            wpmRangeLabel: "50–70 WPM",
            accuracyGoalMin: 95,
            accuracyGoalLabel: "95%+ acc",
        },
        university: {
            targetWpm: 55,
            buffer: 1.35,
            minSec: 7,
            maxSec: 13,
            wpmRangeLabel: "50–70 WPM",
            accuracyGoalMin: 95,
            accuracyGoalLabel: "95%+ acc",
        },
        "ielts-toefl": {
            targetWpm: 33,
            buffer: 1.55,
            minSec: 12,
            maxSec: 24,
            wpmRangeLabel: "30–40+ WPM",
            accuracyGoalMin: 90,
            accuracyGoalLabel: "high acc",
        },
    };

    /** S/A/B gates per tier — accuracy weighted; IELTS favors accuracy over speed. */
    var SPELL_GRADE_THRESHOLDS = {
        "grade-1-6": [
            { grade: "S", minAcc: 90, minWpm: 14 },
            { grade: "A", minAcc: 86, minWpm: 11 },
            { grade: "B", minAcc: 80, minWpm: 7 },
        ],
        "grade-7-12": [
            { grade: "S", minAcc: 95, minWpm: 44 },
            { grade: "A", minAcc: 92, minWpm: 36 },
            { grade: "B", minAcc: 90, minWpm: 26 },
        ],
        work: [
            { grade: "S", minAcc: 98, minWpm: 58 },
            { grade: "A", minAcc: 96, minWpm: 48 },
            { grade: "B", minAcc: 95, minWpm: 38 },
        ],
        academic: [
            { grade: "S", minAcc: 98, minWpm: 62 },
            { grade: "A", minAcc: 96, minWpm: 52 },
            { grade: "B", minAcc: 95, minWpm: 44 },
        ],
        university: [
            { grade: "S", minAcc: 99, minWpm: 65 },
            { grade: "A", minAcc: 97, minWpm: 55 },
            { grade: "B", minAcc: 95, minWpm: 46 },
        ],
        "ielts-toefl": [
            { grade: "S", minAcc: 99, minWpm: 30 },
            { grade: "A", minAcc: 97, minWpm: 26 },
            { grade: "B", minAcc: 94, minWpm: 20 },
        ],
    };

    var TIERS = {
        "grade-1-6": {
            id: "grade-1-6",
            label: "Grade 1–6",
            timeLimitSec: 28,
            scoreMultiplier: 0.85,
            sentences: [
                "The cat is big.",
                "I can run fast.",
                "We go to school.",
                "The sun is hot.",
                "My dog likes milk.",
                "She has a red hat.",
                "Look at the blue sky.",
                "He can jump high.",
                "We play in the park.",
                "The fish can swim.",
                "I like my new book.",
                "Mom made a good cake.",
                "The bird can fly up.",
                "It is fun to read.",
                "We sit on the grass.",
                "The tree is very tall.",
                "I see a bright star.",
                "Dad helps me cook.",
                "The rain is cold today.",
                "We share our lunch.",
                "The bus stops here.",
                "My room is clean now.",
                "We draw with crayons.",
                "The frog can hop well.",
                "I wash my hands first.",
            ],
        },
        "grade-7-12": {
            id: "grade-7-12",
            label: "Grade 7–12",
            timeLimitSec: 15.5,
            scoreMultiplier: 1,
            sentences: [
                "Photosynthesis converts sunlight into chemical energy.",
                "The experiment confirmed our original hypothesis.",
                "Students should revise their notes before the test.",
                "Climate change affects weather patterns worldwide.",
                "The novel explores themes of courage and loss.",
                "Chemical reactions often release heat or gas.",
                "Democracy depends on informed and active citizens.",
                "The orchestra performed a challenging symphony.",
                "Algebra helps us model real world relationships.",
                "The debate team argued both sides clearly.",
                "Ancient civilizations built remarkable stone temples.",
                "The microscope revealed tiny living organisms.",
                "Volunteers organized a community cleanup event.",
                "The graph shows a steady increase over time.",
                "Poetry uses rhythm and imagery to evoke emotion.",
                "The athlete trained daily to improve endurance.",
                "Electric circuits require a complete closed path.",
                "The museum exhibit explained local history well.",
                "Writers edit drafts to strengthen their arguments.",
                "The committee voted on the proposed budget.",
                "Satellites orbit Earth to collect weather data.",
                "The lab report must include clear conclusions.",
                "Geography describes how people use land and water.",
                "The play received praise for its sharp dialogue.",
                "Students analyzed primary sources from the archive.",
            ],
        },
        work: {
            id: "work",
            label: "Work",
            timeLimitSec: 13.4,
            scoreMultiplier: 1.15,
            sentences: [
                "Please review the attached slide deck before Monday.",
                "The sprint retrospective is scheduled for three pm.",
                "Can we sync on blockers during standup tomorrow?",
                "I'll follow up with the client after the demo.",
                "The deployment pipeline failed on the staging build.",
                "Share the meeting notes in the team channel please.",
                "We need sign off from legal before we launch.",
                "The quarterly forecast was updated in the spreadsheet.",
                "Please loop in finance on the revised budget proposal.",
                "The onboarding checklist is due by end of week.",
                "I'll draft the project brief and send it for review.",
                "The vendor contract expires at the end of Q3.",
                "Let's prioritize tickets that block the release train.",
                "The dashboard metrics dipped after the config change.",
                "Please confirm your availability for the stakeholder call.",
                "We escalated the outage to the platform on call team.",
                "The handoff document lists owners for each workstream.",
                "I'll schedule a one on one to discuss career goals.",
                "The pull request needs two approvals before merge.",
                "Please update the roadmap when scope changes are approved.",
                "The customer success team flagged churn risk accounts.",
                "We aligned on OKRs during the leadership offsite.",
                "The expense report must include itemized receipts.",
                "I'll send a recap with action items after the workshop.",
                "The compliance audit requires access logs for thirty days.",
            ],
        },
        academic: {
            id: "academic",
            label: "Academic",
            timeLimitSec: 11.8,
            scoreMultiplier: 1.25,
            sentences: [
                "Scholars debate how archival bias shapes historical narratives.",
                "The methodology section must justify each sampling decision.",
                "Peer review remains the cornerstone of scientific credibility.",
                "The lecture introduced competing theories of economic development.",
                "Researchers replicated the study under stricter controls.",
                "The abstract should state the problem, method, and findings.",
                "Interdisciplinary work often requires translating technical jargon.",
                "The dataset was anonymized to protect participant privacy.",
                "Critical reading asks what evidence supports each claim.",
                "The symposium addressed ethics in artificial intelligence research.",
                "A literature review maps gaps in existing scholarship.",
                "The hypothesis predicts a negative correlation between variables.",
                "Qualitative interviews captured nuance that surveys missed.",
                "The footnotes document primary sources and translations used.",
                "Statistical significance does not always imply practical importance.",
                "The seminar examined postcolonial perspectives on urban planning.",
                "Open access publishing broadens dissemination of academic work.",
                "The panel discussed reproducibility crises in several fields.",
                "Conceptual frameworks guide how researchers interpret results.",
                "The dissertation committee requested clearer operational definitions.",
                "Meta analysis aggregates findings across independent trials.",
                "The grant proposal outlined milestones and evaluation criteria.",
                "Epistemology asks how we know what counts as knowledge.",
                "The colloquium featured a debate on free will and neuroscience.",
                "Citation practices attribute ideas and prevent plagiarism.",
            ],
        },
        university: {
            id: "university",
            label: "University",
            timeLimitSec: 11.8,
            scoreMultiplier: 1.45,
            sentences: [
                "Undergraduate seminars emphasize argumentation over memorization.",
                "The registrar confirmed your transfer credits were accepted.",
                "Laboratory safety training is mandatory before equipment access.",
                "The thesis advisor recommended narrowing the research question.",
                "Residence life policies prohibit open flames in dorm rooms.",
                "The dean's list recognizes sustained academic excellence.",
                "Office hours give students space to clarify difficult concepts.",
                "The capstone project integrates coursework with field experience.",
                "Financial aid packages may combine grants loans and work study.",
                "The reading list includes primary texts and critical commentaries.",
                "Academic probation requires a meeting with student support services.",
                "The lecture hall acoustics made distant questions hard to hear.",
                "Independent study contracts specify deliverables and deadlines.",
                "The honor code prohibits unauthorized collaboration on assessments.",
                "Graduate applicants must submit writing samples and references.",
                "The campus writing center helps refine drafts at any stage.",
                "Course evaluations inform teaching assignments for next term.",
                "The library database indexes journals across multiple disciplines.",
                "Study abroad programs require passport and visa documentation.",
                "The midterm rubric weights analysis more heavily than summary.",
                "Research assistants code interview transcripts for thematic patterns.",
                "The syllabus outlines late submission and extension policies.",
                "Faculty senate votes on curriculum changes each spring.",
                "The poster session showcased undergraduate research across departments.",
                "Academic advisors help students plan prerequisites for majors.",
            ],
        },
        "ielts-toefl": {
            id: "ielts-toefl",
            label: "IELTS/TOEFL",
            timeLimitSec: 24,
            scoreMultiplier: 1.35,
            sentences: [
                "Although urbanization creates jobs, it also strains public infrastructure.",
                "The lecturer argued that renewable subsidies accelerate adoption unevenly.",
                "Notwithstanding recent gains, inequality persists across several regions.",
                "The passage implies that cultural preservation requires sustained funding.",
                "Proponents contend that standardized testing improves accountability nationwide.",
                "The experiment demonstrated that sleep deprivation impairs working memory.",
                "Critics maintain that the policy disproportionately affects rural communities.",
                "The author distinguishes between correlation and causation with notable clarity.",
                "International agreements seldom succeed without credible enforcement mechanisms.",
                "The survey respondents reported higher satisfaction after the redesign.",
                "Conversely, excessive regulation may discourage entrepreneurial investment.",
                "The historian cautioned against interpreting artifacts without archaeological context.",
                "Biodiversity loss threatens ecosystem services that agriculture depends upon.",
                "The committee recommended phased implementation to mitigate transition costs.",
                "Empirical evidence suggests that bilingual education confers cognitive advantages.",
                "The editorial questioned whether privatization would lower long term costs.",
                "Not only did emissions rise, but public health outcomes also worsened.",
                "The professor emphasized synthesizing sources rather than summarizing them.",
                "Had the treaty been ratified earlier, emissions might have plateaued sooner.",
                "The paragraph concludes that interdisciplinary collaboration drives innovation.",
                "Stakeholders demanded transparency regarding how funds were allocated.",
                "The narrative chronicles how migration reshaped demographic profiles.",
                "It is widely acknowledged that climate models incorporate substantial uncertainty.",
                "The speaker refuted the claim that automation inevitably reduces employment.",
                "Sustainable development balances economic growth with environmental stewardship.",
            ],
        },
    };

    var TIER_ORDER = [
        "grade-1-6",
        "grade-7-12",
        "work",
        "academic",
        "university",
        "ielts-toefl",
    ];

    var FALLBACK = "Focus your mana and strike true.";

    function getTierTiming(tierId) {
        return TIER_TIMING[tierId] || TIER_TIMING[DEFAULT_TIER_ID];
    }

    function countWords(sentence) {
        if (!sentence) return 1;
        var parts = sentence.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return Math.max(1, Math.ceil(sentence.length / 5));
        return parts.length;
    }

    function computeSpellTimeLimitSec(sentence, tierId) {
        var cfg = getTierTiming(tierId);
        var words = countWords(sentence);
        var seconds = (words / cfg.targetWpm) * 60 * cfg.buffer;
        var rounded = Math.round(seconds * 10) / 10;
        return Math.max(cfg.minSec, Math.min(cfg.maxSec, rounded));
    }

    function medianTimeLimitForTier(tierId) {
        var tier = getTier(tierId);
        var times = (tier.sentences || []).map(function (s) {
            return computeSpellTimeLimitSec(s, tierId);
        });
        if (!times.length) return getTierTiming(tierId).minSec;
        times.sort(function (a, b) { return a - b; });
        return times[Math.floor(times.length / 2)];
    }

    function refreshTierDisplayTimers() {
        TIER_ORDER.forEach(function (id) {
            TIERS[id].timeLimitSec = medianTimeLimitForTier(id);
        });
    }

    function getTier(tierId) {
        return TIERS[tierId] || TIERS[DEFAULT_TIER_ID];
    }

    function getStoredTierId() {
        try {
            var id = localStorage.getItem(TIER_STORAGE_KEY);
            if (id && TIERS[id]) return id;
        } catch (_e) { /* ignore */ }
        return DEFAULT_TIER_ID;
    }

    function setStoredTierId(tierId) {
        if (!TIERS[tierId]) tierId = DEFAULT_TIER_ID;
        try {
            localStorage.setItem(TIER_STORAGE_KEY, tierId);
        } catch (_e) { /* ignore */ }
        return tierId;
    }

    /**
     * Within a tier bank, dungeon level picks shorter → longer sentences
     * (by word count thirds). Each tier bank is already a distinct difficulty band.
     */
    function pickFromBank(bank, level) {
        var lv = Math.max(1, level | 0);
        if (!bank || !bank.length) return FALLBACK;

        var ranked = bank.map(function (s) {
            return { text: s, words: countWords(s) };
        });
        ranked.sort(function (a, b) {
            return a.words - b.words || a.text.length - b.text.length;
        });

        var n = ranked.length;
        var shortEnd = Math.max(1, Math.ceil(n * 0.34));
        var midEnd = Math.max(shortEnd + 1, Math.ceil(n * 0.67));
        var slice;

        if (lv <= 2) {
            slice = ranked.slice(0, shortEnd);
        } else if (lv <= 4) {
            slice = ranked.slice(shortEnd, midEnd);
        } else {
            slice = ranked.slice(midEnd);
        }
        if (!slice.length) slice = ranked;

        return slice[Math.floor(Math.random() * slice.length)].text;
    }

    function pickForLevel(level, tierId) {
        var tier = getTier(tierId || getStoredTierId());
        return pickFromBank(tier.sentences || [], level);
    }

    function applySentenceBanks() {
        var banks = global.SENTENCE_BANKS;
        if (!banks) return;
        TIER_ORDER.forEach(function (id) {
            var list = banks[id];
            if (list && list.length) TIERS[id].sentences = list.slice();
        });
    }

    /** Maps dungeon depth to progressively harder typing tiers. */
    function tierForDungeonLevel(level) {
        var lv = Math.max(1, level | 0);
        var index = Math.min(TIER_ORDER.length - 1, lv - 1);
        return TIER_ORDER[index];
    }

    function pickSpellForCast(level, tierId) {
        var id = tierId || tierForDungeonLevel(level) || getStoredTierId();
        var sentence = pickForLevel(level, id);
        return {
            sentence: sentence,
            timeLimitSec: computeSpellTimeLimitSec(sentence, id),
            tierId: id,
        };
    }

    function getTimeLimitSec(tierId, sentence) {
        if (sentence) return computeSpellTimeLimitSec(sentence, tierId);
        return getTier(tierId).timeLimitSec;
    }

    function getExpectedWpmLabel(tierId) {
        var timing = getTierTiming(tierId);
        return timing.wpmRangeLabel || ("~" + timing.targetWpm);
    }

    function getAccuracyGoalMin(tierId) {
        return getTierTiming(tierId).accuracyGoalMin;
    }

    function getAccuracyGoalLabel(tierId) {
        return getTierTiming(tierId).accuracyGoalLabel;
    }

    function getSpellGradeThresholds(tierId) {
        return SPELL_GRADE_THRESHOLDS[tierId] || SPELL_GRADE_THRESHOLDS[DEFAULT_TIER_ID];
    }

    function computeSpellGrade(wpm, acc, tierId) {
        var w = wpm | 0;
        var a = acc | 0;
        var gates = getSpellGradeThresholds(tierId);
        for (var i = 0; i < gates.length; i++) {
            var g = gates[i];
            if (a >= g.minAcc && w >= g.minWpm) return g.grade;
        }
        return "C";
    }

    function getScoreMultiplier(tierId) {
        return getTier(tierId).scoreMultiplier;
    }

    function formatTierPillLabel(tierId) {
        var t = getTier(tierId);
        var timing = getTierTiming(tierId);
        return t.label + " · " + timing.wpmRangeLabel + " · base " + timing.targetWpm;
    }

    function listTiers() {
        return TIER_ORDER.map(function (id) {
            var t = TIERS[id];
            var timing = getTierTiming(id);
            return {
                id: t.id,
                label: t.label,
                timeLimitSec: t.timeLimitSec,
                scoreMultiplier: t.scoreMultiplier,
                wpmRangeLabel: timing.wpmRangeLabel,
                accuracyGoalMin: timing.accuracyGoalMin,
                accuracyGoalLabel: timing.accuracyGoalLabel,
                targetWpm: timing.targetWpm,
            };
        });
    }

    function formatMultiplierLegend() {
        return TIER_ORDER.map(function (id) {
            return formatTierDisplay(id);
        }).join(" · ");
    }

    function formatTierMultiplier(mult) {
        return mult % 1 === 0 ? String(mult) : mult.toFixed(2).replace(/\.?0+$/, "");
    }

    function getTierLabel(tierId) {
        return getTier(tierId).label;
    }

    function formatTierDisplay(tierId) {
        var t = getTier(tierId);
        return t.label + " ×" + formatTierMultiplier(t.scoreMultiplier);
    }

    applySentenceBanks();
    refreshTierDisplayTimers();

    global.SentenceBank = {
        TIERS: TIERS,
        TIER_ORDER: TIER_ORDER,
        TIER_STORAGE_KEY: TIER_STORAGE_KEY,
        DEFAULT_TIER_ID: DEFAULT_TIER_ID,
        getTier: getTier,
        getStoredTierId: getStoredTierId,
        setStoredTierId: setStoredTierId,
        tierForDungeonLevel: tierForDungeonLevel,
        pickForLevel: pickForLevel,
        applySentenceBanks: applySentenceBanks,
        pickSpellForCast: pickSpellForCast,
        countWords: countWords,
        computeSpellTimeLimitSec: computeSpellTimeLimitSec,
        getTimeLimitSec: getTimeLimitSec,
        getExpectedWpmLabel: getExpectedWpmLabel,
        getAccuracyGoalMin: getAccuracyGoalMin,
        getAccuracyGoalLabel: getAccuracyGoalLabel,
        getSpellGradeThresholds: getSpellGradeThresholds,
        computeSpellGrade: computeSpellGrade,
        getTierTiming: getTierTiming,
        getScoreMultiplier: getScoreMultiplier,
        listTiers: listTiers,
        formatMultiplierLegend: formatMultiplierLegend,
        formatTierPillLabel: formatTierPillLabel,
        getTierLabel: getTierLabel,
        formatTierDisplay: formatTierDisplay,
        formatTierMultiplier: formatTierMultiplier,
    };
})(window);
