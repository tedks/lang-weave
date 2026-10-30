# Lang Weave: what the learning science says

Research lane report, 2026-10-30. Grounded in `docs/DESIGN.md`, `docs/GRADUAL-MISSION.md`, `docs/LEARNING-MISSION.md` and `extension/src/{review,learning,adaptive,levels,encounters,content}.js` (read-only checkout `store-progress-portability`).

Evidence labels: **[Strong]** replicated or meta-analytic; **[Moderate]** several studies with caveats or a transfer assumption; **[Thin]** a few small studies, or an untested extrapolation to this kind of product.

**Honest headline.** Research on *in-page word substitution* itself is thin. It amounts to one small controlled study (Broccoli, N=58, one sitting), Mechanical Turk work on "macaronic" text, an older CHI paper, and no controlled evaluation of Toucan or Google's Language Immersion. Most of what follows is borrowed from incidental vocabulary learning and from retrieval and spacing research. Broccoli is the key datum. In-page substitution beat explicit memorisation immediately, but **the advantage vanished after 1–4 weeks**, with both near 30% on a six-option test. Exposure alone does not make words stick. Lang Weave's scheduled retrieval layer is the part that has to work.

---

## Executive summary: ranked recommendations

| # | Change | Evidence | Expected effect | Cost | Falsified if |
|---|---|---|---|---|---|
| 1 | **Log reviews and exposures locally, and measure retention.** For each retrieval, record word ID, time, source (inline or standalone), direction, outcome, latency, days since the last review, scheduled interval and predicted recall. Keep per-word exposure aggregates. Add a small "is this working?" panel. | Prerequisite. `review.js` stores only `due`, `interval` and `reviews`, so neither retention nor elapsed time can be computed today. | Makes every other change testable. | S–M | Not falsifiable; it is instrumentation. Keep it word-ID-only, as `encounters.js` does. |
| 2 | **Schedule on actual elapsed time and keep memory across lapses by adopting FSRS** with default parameters and a desired retention of about 0.85–0.90. | [Strong] spacing; [Moderate] FSRS beats SM-2 variants on Anki logs; model-based review beat a generic spaced schedule by 10% in a Spanish course. | Fewer wasted reviews and better-timed ones. This matters more here than in Anki because in-the-wild reviews happen at irregular times. | M | After a few hundred reviews, predicted recall is no better calibrated than a constant, or measured retention misses the target by more than 10 points. |
| 3 | **Grade objectively where it is cheap.** Use typed recall checked by the existing accent-aware normaliser, or four options. Record correctness and latency, and cut self-rating to Again / Good, with Easy optional. | [Strong] self-judgments are poorly calibrated; [Moderate] using "Hard" as a pass corrupts scheduler data. | A cleaner scheduling signal and an honest "words learned" count. | M | Objective and self-graded cards show the same calibration and retention while costing more time. |
| 4 | **Engineer encounters, not only reviews.** Target 8–12 in-context encounters over distinct days in a word's first 3 weeks. Cap placements of the same word at 2–3 a day, and rank under-exposed learning words first. | [Strong] encounter count is the most reliable predictor of incidental learning; words met fewer than 8 times were not retained at 3 months; spacing beats massing. | More words cross the recognition threshold. This is the lever a flashcard app does not have. | M | Words that hit the target show no better first-review recall than words that missed it. |
| 5 | **Retire "familiar forever".** Replace permanent `familiar` with very long maintenance intervals. Treat "Already know" as a claim and verify it with one later retrieval. | [Moderate] learners drop cards too early, and it costs them. | Prevents silent attrition of words the user believes they know. | S | Verification retrievals succeed at 95% or more. |
| 6 | **Vary the context.** Prefer a site or topic unlike the word's recent ones. In standalone review, show a rotating example sentence with a blank instead of the bare gloss. | [Moderate] contextual diversity helps L2 word learning and generalisation, with small, learner-dependent effects. | Better transfer to new texts. | M | Rotating-sentence words show no better recall on novel pages than gloss-only words. |
| 7 | **Count peeks as weak failure evidence.** A hover-to-meaning on a learning word may mark it weak or bring it forward, never push it later. An un-peeked sighting is never success. | [Thin] no direct study. Consistent with the current rule that sightings are not mastery. | Catches forgetting between reviews at no cost to the user. | S | Peeked words recall as well at their next review as un-peeked words. |
| 8 | **Opt-in inference on first encounters.** For new or due words, the hover offers 3–4 candidate meanings, or a "guess first" step, before the answer. | [Moderate] multiple-choice glosses were the most effective gloss type in a meta-analysis; [Thin–Moderate] guessing before feedback helps in some studies, with mixed replications. | Turns passive exposure into retrieval, the step Broccoli lacked. | M | Users of the option show no retention gain, or abandon it. |
| 9 | **Track receptive and productive knowledge separately.** Reading exercises Spanish→meaning; review tests meaning→Spanish. Start with receptive retrieval and add productive retrieval once receptive is stable. | [Moderate] each kind of task builds mainly its own kind of knowledge; receptive tasks suit beginners. | Fewer early failures and an honest read-versus-produce picture. | M | Splitting doubles the load without improving either direction. |
| 10 | **Cap truly unknown words near 2% of running words** regardless of the density setting. Introduce new words where they are guessable, with cognates first. | [Moderate] 95–98% known-word coverage supports comprehension and inference; macaronic research chooses words by guessability. | Reading stays comfortable, so the tool stays on. | S | Raising the cap leaves peek and flip rates unchanged. |
| 11 | **Build motivation on competence, not loss.** Avoid streak-loss mechanics. Offer an if-then plan for the review. Show verified progress, such as words recalled at 3 weeks or more and the share of this week's reading the user could read in Spanish. | [Strong] implementation intentions d≈0.65; [Moderate] controlling rewards can undermine intrinsic motivation, and gamification effects are small and unstable. | A steadier review habit without guilt spirals, in line with the Goals app. | S–M | Review completion does not change, or users feel pressured. |
| 12 | **Raise the vocabulary ceiling.** The pack has 226 words, while useful coverage of real Spanish needs roughly 2–3k high-frequency families. Grow it by frequency weighted by what the user reads. | [Strong] coverage arithmetic. | Sets how far anyone can get. | L | Users rarely exhaust the current pack. |

The first milestone is 1–3: log, schedule on elapsed time, grade honestly. Items 4–7 are the in-the-wild advantage, and item 11 is cheap enough to ride along.

---

## Evidence

### 1. Incidental vocabulary learning from reading

- **Coverage.** Adequate comprehension needs about 98% of running words known, with 95% as a minimum (Hu & Nation 2000, via Nation 2006: https://www.wgtn.ac.nz/__data/assets/pdf_file/0018/1626120/2006-How-large-a-vocab.pdf ; Schmitt et al. 2015: https://www.lextutor.ca/cover/papers/schmitt_cobb_etal_2015.pdf). Replications show comprehension degrading gradually rather than at a sharp cliff (https://aila2021.dryfta.com/program/abstract-archive/abstract/public/416/unknown-vocabulary-density-reading-comprehension-and-the-98-coverage-figure-replicating-hu-nation-2000 ; https://nflrc.hawaii.edu/rfl/item-detail/654). In Lang Weave the reader knows all the English, so only still-unknown swapped words count against coverage. Recommendation 10 is therefore a direct translation of this result. **[Moderate]**
- **Encounters.** Gains appear after about 3 encounters and are substantial around 10 (Webb 2007, *Applied Linguistics* 28(1)). In an authentic novel, words met more than 10 times reached 84% meaning recognition, with much lower meaning recall (Pellicer-Sánchez & Schmitt 2010: https://nflrc.hawaii.edu/rfl/item-detail/207). From one graded reader almost nothing survived 3 months, and no word met fewer than 8 times did (Waring & Takaki 2003: https://www.wgtn.ac.nz/__data/assets/pdf_file/0008/1626146/Waring-Takaki-2003.pdf). Exposure count was the strongest eye-tracking predictor of learning (Godfroid et al. 2018: https://www.cambridge.org/core/product/9DE8BB8989973448A4245C87522D72C1). Meta-analytically, repetition correlates with learning at r≈.34 (Uchihara, Webb & Yanagisawa 2019: https://www.cambridge.org/core/product/E38E3468FD2090B1FA3051051DE8E70C). Gains per text are small, around 15% immediately (2023 meta-analysis: https://todoele.net/bibliografia/how-effective-second-language-incidental-vocabulary-learning-meta-analysis). **[Strong]**
- **Scope.** Nation's four strands divide learning among meaning-focused input, output, deliberate study and fluency (https://cunningham.acer.edu.au/inted/eaconf95/nation2.pdf). Lang Weave covers part of input and part of deliberate study. It does not teach grammar, output or listening, and it should say so.

### 2. Retrieval, recall versus recognition, self-assessment

- Retrieving foreign words repeatedly produced large gains a week later, while restudying produced none. Students' predictions were *uncorrelated* with their performance (Karpicke & Roediger 2008: https://pubmed.ncbi.nlm.nih.gov/18276894/). A 2015 replication kept the testing advantage (https://www.psychologicalscience.org/journals/psychological-science/0956797615617778/). **[Strong]**
- Deliberate card learning builds real lexical representations (Elgort 2011: https://www.lextutor.ca/freq/lists_download/elgort_2011.pdf). Word cards produce sizeable gains (Webb, Yanagisawa & Uchihara 2020, *MLJ* 104(4)). Flashcards are not the enemy; unscheduled, context-free cards are merely incomplete. **[Strong]**
- Receptive and productive knowledge do not transfer automatically. Each task type builds mainly its own kind, and receptive tasks suit lower-level learners (Webb 2005: https://www.cambridge.org/core/product/DDF362AE7B13D1949B1CD591DA2F3414 ; https://ir.wgtn.ac.nz/handle/123456789/23701?show=full). Recall is harder and more diagnostic than recognition (Laufer & Goldstein 2004, *Language Learning* 54). **[Moderate]**
- Spacing helped 90% of learners, yet 72% believed cramming had worked better (Kornell 2009: https://cir.nii.ac.jp/crid/1361699994055985152). Learners also drop cards prematurely (Kornell & Bjork 2008: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Kornell_Bjork_2008_Memory.pdf). Self-assessment alone should neither retire a word nor define success.

### 3. Spacing and scheduling: SM-2 versus FSRS

- The optimal review gap grows with the retention horizon (Cepeda et al. 2008: https://pubmed.ncbi.nlm.nih.gov/19076480/). Spacing roughly doubled L2 vocabulary gains at one week, and expanding schedules showed no consistent edge over equal spacing (Nakata 2015, *SSLA* 37(4); review: https://kansai-u.repo.nii.ac.jp/records/10256). **[Strong]**
- Model-based personalised review in a Spanish course beat a generic spaced schedule by 10% and massed study by 16.5% (Lindsey et al. 2014: https://home.cs.colorado.edu/~mozer/Research/Selected%20Publications/reprints/LindseyShroyerPashlerMozer2014.pdf). **[Strong]** that a memory model beats a fixed rule. The model was not FSRS.
- **FSRS** grew from Ye, Su & Cao's KDD 2022 scheduler, trained on 220M review logs (https://dblp1.uni-trier.de/rec/conf/kdd/YeSC22.html). It models each card's stability and difficulty and predicts recall from elapsed time against a target retention (https://github.com/open-spaced-repetition/fsrs4anki/wiki/abc-of-fsrs ; https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm.md). The community benchmark reports FSRS beating a trainable SM-2 on most collections (https://forums.ankiweb.net/t/fsrs-vs-sm2-in-2-seperate-profiles/52171). SuperMemo, a competitor, disputes the metric (https://supermemo.com/en/blog/supermemo-is-better-than-fsrs-by-far). Duolingo's half-life regression roughly halved prediction error against Leitner (https://preview.aclanthology.org/landing_page/P16-1174). **[Moderate]**: these are prediction benchmarks on flashcard logs, not randomised learning trials.
- **Why it is worth it here.**
  - *The current rules waste reviews.* "Hard" sets the interval to 1 day whatever the history, so a 60-day word drops to 1. "Again" zeroes the interval, so every lapse restarts from nothing. Medium and Easy multiply the *scheduled* interval and ignore lateness, yet in a passive tool late review is the normal case.
  - *Defaults suffice.* Per-user fitting needs hundreds of reviews (https://forums.ankiweb.net/t/how-many-reviews-for-accurate-optimization/53320), so ship the defaults.
  - *Packaging.* `ts-fsrs` is MIT, supports FSRS-6 and later, and ships ESM and UMD builds (https://github.com/open-spaced-repetition/ts-fsrs). The extension has no build step, so either vendor its ESM file with the licence notice or port the roughly 150 lines of formulas. MIT is compatible with an AGPL relicense.
  - *Unknown.* FSRS defaults come from self-graded flashcards. In-page recall and peeks are different memory events, so check calibration on the user's own log (recommendation 1).

### 4. Desirable difficulties, interleaving, generation

- Spacing, retrieval, interleaving and varied practice slow acquisition but improve retention, provided the difficulty is one the learner can overcome (Bjork & Bjork 2011: https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf). Harder foreign-vocabulary training improved retention and transfer (Schneider, Healy & Bourne 2002, *JML* 46). **[Strong]** in general; **[Moderate]** for vocabulary interleaving. Nakata & Suzuki's interleaving gain was for grammar (*MLJ* 2019), and vocabulary results depend on whether words are semantically related (*SSLA* 41(2)). Interleave directions and contexts, and avoid themed batches of new words.
- Guessing before feedback can help (Potts & Shanks 2014: https://discovery-pp.ucl.ac.uk/id/eprint/1399515/1/RPottsLastRevision.pdf), but replications are mixed (https://link.springer.com/article/10.3758/s13421-021-01218-6). **[Thin–Moderate]**
- Heavy semantic processing can starve form learning (Barcroft's TOPRA model: https://www.cambridge.org/core/product/E785E9225B1D21D5C5B0B2B7C1D0655C). Hover glosses emphasise meaning, while productive recall forces attention to form, which supports recommendation 9. **[Moderate]**

### 5. Glosses, marking, contextual diversity

- Glosses aid vocabulary learning from reading. Multiple-choice glosses were most effective, and L1 glosses beat L2 glosses (Yanagisawa, Webb & Uchihara 2020: https://www.cambridge.org/core/product/38124150D59DF3039EE1FF5AE88FE922). Lang Weave's English hover is an L1 gloss. **[Moderate–Strong]**
- Bold marking helped immediate form recognition but not meaning in a Spanish-L2 study (https://todoele.net/bibliografia/effects-word-frequency-and-typographical-enhancement-incidental-vocabulary-learning). Styling attracts attention; it is not a learning mechanism. **[Thin]**
- The number of distinct contexts predicts word recognition better than raw frequency (Adelman, Brown & Quesada 2006: https://www.psychologicalscience.org/journals/psychological-science/j.1467-9280.2006.01787.x/). Diversity improves incidental learning in a foreign language (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7435265/), with small effects that depend on prior vocabulary (https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/effects-of-contextual-diversity-on-incidental-vocabulary-learning/F83A1EB55404E2E07FDC1695B0BC2BAE). It also aids generalisation (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10280660/). **[Moderate]**

### 6. In-situ substitution research

- **Broccoli** (WWW 2020: https://arxiv.org/abs/2104.07941). Fifty-eight participants learned 78 English→Finnish words in a within-subject design. Each Broccoli word appeared translated 7 times, and explicit table memorisation was the comparison. Broccoli was significantly better immediately, with no difference at 1–4 weeks (around 30% correct against 20% chance). Learners used far fewer mnemonic strategies with Broccoli. Spaced repetition was not tested and is called "orthogonal". The authors found that everyday information diets are compatible with spaced-repetition timing. **[Thin]**: one session and recognition tests only.
- **Macaronic text** (Renduchintala, Knowles, Koehn & Eisner). The work comprises a mixed-language reading interface (https://aclanthology.org/P16-4023/), a study of how novices guess new words in context (https://aclanthology.org/K16-1013/), and a "machine teacher" that picks replacements with a simulated student. Crowdworkers guessed introduced words accurately and kept them after the document (https://aclanthology.org/W19-4439/), and modelling spelling improved the choices (https://aclanthology.org/D19-1679/). **[Thin]** The idea to transfer is choosing *where* to introduce a word by how guessable it is there.
- **Trusty & Truong, CHI 2011** augmented L1 browsing with L2 words (https://dl.acm.org/doi/10.1145/1978942.1979414). The full text was inaccessible, so no results are claimed from it.
- **Zeeguu** generates exercises from the original reading context (https://mircealungu.com/docs/assets/papers/18-AsWeMayStudy.pdf). Its one-month classroom pilot drew positive reactions, with no controlled outcomes.
- **Toucan and Language Immersion for Chrome** have no peer-reviewed evaluations. Reviews document sense errors such as "He nunca looked espalda" (https://naturallyprocessed.substack.com/p/escaping-duolingoland ; https://www.pcworld.com/article/418663/how-to-turn-chrome-into-a-language-tutor.html).

### 7. Comprehensible input and its critics

Krashen's input hypothesis motivates extensive reading and macaronic text. The mainstream now treats input as necessary but insufficient. Schmidt's noticing hypothesis requires attention, and Swain's output hypothesis requires production (https://jalt-publications.org/tlt/articles/2198-output-and-beyond-dialogue-review-merrill-swains-current-approach-sla). The involvement-load hypothesis rates plain reading low on need, search and evaluation, and meta-analysis supports its components with unequal weights (https://www.cambridge.org/core/product/5C5984B326F37FBF3A3DDA3C0EB2996C). **[Moderate]** For Lang Weave, i+1 justifies low new-word density, and the critics justify light retrieval and inference on top of exposure.

### 8. Motivation and habit

- Habit automaticity took a median of about 66 days in a small sample, and *missing a single day did not derail it* (Lally et al. 2010: https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit). Streaks that punish one lapse fight that finding. **[Moderate]**
- If-then plans have d≈0.65 (Gollwitzer & Sheeran 2006: https://kops.uni-konstanz.de/entities/publication/2e749bfb-8533-437c-8203-7e788c910c5f). WOOP, which Ted's Goals app uses, shows g≈0.34 (https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.565202/pdf). **[Strong]**
- Expected tangible rewards undermine intrinsic motivation (Deci, Koestner & Ryan 1999: https://depts.washington.edu/techdocs/papers/deciExtrinsicRewardsAndIntrinsicMotivation99.pdf). Gamification's motivational effects are small and unstable (Sailer & Homner 2020: https://link.springer.com/article/10.1007/s10648-019-09498-w). Duolingo's streak claims are anecdotal. **[Moderate]**
- A hypothesis **[Thin]**: Lang Weave already has a natural variable reward, a learned word appearing unpredictably in chosen reading and being understood. Surface that moment quietly instead of adding slot-machine mechanics.

### 9. What to measure

1. Next-day recall after introduction.
2. Retention at intervals of 21 days or more, against the scheduler's target.
3. Calibration of predicted against observed recall, before trusting any scheduler.
4. **Verified-known count**: words recalled at intervals of 21 days or more. This should replace "words introduced" as the headline.
5. Per-word peek rate over time, a free receptive signal.
6. Exposures and distinct days per learning word, against recommendation 4's target.
7. Workload in reviews per day and seconds per review, plus leeches (4 or more lapses), which should get a new context or a mnemonic.
8. Optional personal experiments that randomise *words* between conditions within one learner.

---

## What the current code already does right

- **Retrieval before reveal.** The review page and the inline cue both demand recall before the answer, with one rating per ticket (`review.js`).
- **Sightings, peeks and flips never count as mastery** (`events.js`, LEARNING-MISSION). The recall literature and Broccoli's delayed null both warn exactly about this.
- **A daily new-word budget and a backlog throttle** (`adaptive.js`) bound the workload. Review debt is how SRS habits usually die.
- **A card is created only after a visible in-context placement** (`learning.js`), so the first encounter is meaningful.
- **Due and weak words get placement priority, and the prompt spreads learning words across passages** (`prompt.js`).
- **Inline recall waits until the day after introduction** (`introGateDay`), which spaces the first retrieval.
- **New words are ranked by recurrence in this user's reading** (`encounters.js`). Words introduced this way will be met again.
- **Deterministic gloss and sense validation** (`levels.js`) prevents the wrong-sense exposures documented for Toucan.
- **L1 hover glosses appear after a dwell delay**, which leaves a moment for inference.
- **Counters are bounded and contain no URLs or text**, a pattern the logging in recommendation 1 should follow.

---

## Open questions

1. **For Ted: is productive recall a goal, or only reading?** The answer sets recommendation 9's weight and whether typing is worth the friction.
2. Should an in-page recall weigh the same as a standalone review? Only the log can tell.
3. Contextual diversity needs some memory of where a word appeared. Would a salted host-hash bucket count be acceptable under the no-URL rule?
4. How much inference or typing will users of a "passive" tool accept? Keep recommendations 3 and 8 opt-in until measured.
5. Is 5 new words a day right? With FSRS in place, the steady-state review load can be simulated.
6. Does real browsing supply enough encounters for mid-frequency words, or must standalone review fill the gap?
7. Someone with ACM access should check Trusty & Truong's results before Lang Weave cites them.
