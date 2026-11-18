/**
 * ============================================================
 *  Smart Braille Platform — Voice Assistant v2
 *  • Context-aware TTS: dashboard reads lesson titles only
 *  • Dynamic navigation: "enter to [lesson]" → open lesson
 *  • "enter to [lesson] quiz" → open quiz
 *  • "close" → go back
 *  • Tamil + English voice commands
 * ============================================================
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     TTS ENGINE
  ═══════════════════════════════════════════════════════════ */
  const synth = window.speechSynthesis;

  function speak(text, lang, onEnd) {
    if (!synth) return;
    synth.cancel();
    if (!text || !text.trim()) return;
    
    // ✨ "Perfect Output" Fix: Tiny 100ms delay avoids browser-level interruptions
    setTimeout(() => {
        lang = lang || detectLang();
        const utt = new SpeechSynthesisUtterance(text.trim());
        utt.lang = lang;
        utt.rate = 1;
        utt.pitch = 1;
        if (onEnd) utt.onend = onEnd;
        synth.speak(utt);
    }, 100);
  }

  function stopSpeaking() {
    synth.cancel();
  }

  /* ═══════════════════════════════════════════════════════════
     PAGE CONTEXT  (set by individual templates via VA_PAGE_DATA)
  ═══════════════════════════════════════════════════════════
     Structure expected:
     window.VA_PAGE_DATA = {
       page: 'student_dashboard' | 'instructor_dashboard' | 'view_lesson' | ...
       lessons: [{ id, title, viewUrl, quizUrl }],  // dashboard only
       currentLesson: { id, title, hasQuiz, quizUrl }  // view_lesson only
     }
  ═══════════════════════════════════════════════════════════ */
  function pageData() {
    return window.VA_PAGE_DATA || {};
  }

  /* ─── smart read: context-sensitive ──────────────────────── */
  function smartRead() {
    const pd = pageData();

    // DASHBOARD → read lesson titles only
    if (pd.page === 'student_dashboard' || pd.page === 'instructor_dashboard') {
      const lessons = pd.lessons || [];
      if (lessons.length === 0) {
        speak('No lessons available yet.');
        return 'No lessons to read';
      }
      const intro = `You have ${lessons.length} lesson${lessons.length > 1 ? 's' : ''}. `;
      const titles = lessons.map((l, i) => `Lesson ${i + 1}: ${l.title}`).join('. ');
      speak(intro + titles);
      return `Reading ${lessons.length} lesson titles`;
    }

    // LESSON PAGE → read lesson content
    const lessonData = document.getElementById('lesson-data');
    if (lessonData) {
      const content = lessonData.dataset.content;
      if (content) { speak(content, detectLang()); return 'Reading lesson content'; }
    }

    // DEFAULT → read visible page text
    speak(getPageText(), detectLang());
    return 'Reading page';
  }

  /* ─── generic page text scraper ─────────────────────────── */
  function getPageText() {
    const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','BUTTON','NAV','FOOTER']);
    const root = document.querySelector('main') || document.body;
    let txt = '';
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p) {
          if (SKIP.has(p.tagName) || p.id === 'va-widget') return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walk.nextNode())) txt += n.textContent.trim() + ' ';
    return txt.trim();
  }

  /* ─── page language ─────────────────────────────────────── */
  function detectLang() {
    const meta = document.querySelector('meta[name="page-language"]');
    if (meta) return meta.content === 'tamil' ? 'ta-IN' : 'en-US';
    const tamilChars = (document.body.innerText.match(/[\u0B80-\u0BFF]/g) || []).length;
    return tamilChars > 20 ? 'ta-IN' : 'en-US';
  }

  /* ═══════════════════════════════════════════════════════════
     LESSON FUZZY MATCHER
     Finds the best lesson from VA_PAGE_DATA that matches a
     spoken name like "physics", "maths lesson", "science"
  ═══════════════════════════════════════════════════════════ */
  function findLesson(query) {
    const lessons = (pageData().lessons || []);
    if (!lessons.length) return null;

    const q = normalize(query);

    // 1. Exact title match
    let best = lessons.find(l => normalize(l.title) === q);
    if (best) return best;

    // 2. Spaceless match (for cases like "cybersecurity" vs "cyber security")
    const qClean = q.replace(/\s+/g, '');
    best = lessons.find(l => normalize(l.title).replace(/\s+/g, '') === qClean);
    if (best) return best;

    // 3. Title contains query words
    const words = q.split(/\s+/).filter(w => w.length > 2);
    let topScore = 0;
    for (const l of lessons) {
      const t = normalize(l.title);
      let score = 0;
      for (const w of words) {
        if (t.includes(w)) score += w.length;
      }
      if (score > topScore) { topScore = score; best = l; }
    }
    return topScore > 0 ? best : null;
  }

  function normalize(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\u0B80-\u0BFF\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ═══════════════════════════════════════════════════════════
     COMMAND ROUTER
  ═══════════════════════════════════════════════════════════ */

  /**
   * Try to match dynamic lesson-based commands first.
   * Returns { feedback, navigate } or null.
   */
  function matchDynamic(raw) {
    const t = raw;

    // ── SIMPLEST: "close" / "back" / "மூடு" → go back (checked first!) ──
    if (/^(close|back|go back|மூடு|திரும்பு)$/i.test(t)) {
      window.history.back();
      return { feedback: 'Going back', navigate: null };
    }

    // ── SIMPLEST: "open [name]" → open lesson ──────────────────────────
    // Matches: "open science", "open cyber security", "open iot"
    const simpleOpen = t.match(/^open\s+(.+)$/i);
    if (simpleOpen) {
      const query = simpleOpen[1]
        .replace(/\b(lesson|quiz|பாடம்)\b/gi, '')
        .trim();
      // check for quiz suffix
      if (/quiz\b/i.test(simpleOpen[1])) {
        const lesson = findLesson(query);
        if (lesson && lesson.quizUrl) {
          return { feedback: `Opening ${lesson.title} quiz`, navigate: lesson.quizUrl };
        }
        if (lesson) return { feedback: `${lesson.title} has no quiz`, navigate: null };
      }
      const lesson = findLesson(query);
      if (lesson) return { feedback: `Opening ${lesson.title}`, navigate: lesson.viewUrl };
    }

    // ── "[name] quiz" → open quiz ─────────────────────────────────────
    const justQuiz = t.match(/^(.+?)\s+quiz$/i);
    if (justQuiz) {
      const query = justQuiz[1].replace(/\b(open|lesson|பாடம்)\b/gi, '').trim();
      const lesson = findLesson(query);
      if (lesson && lesson.quizUrl) {
        return { feedback: `Opening ${lesson.title} quiz`, navigate: lesson.quizUrl };
      }
      if (lesson) return { feedback: `${lesson.title} has no quiz`, navigate: null };
    }

    // ── "enter to X quiz" / "go to X quiz" ───────────────────────────
    const quizPatterns = [
      /(?:enter\s+to|go\s+to|open|start)\s+(.+?)\s+quiz/i,
      /(.+?)\s+(?:quiz|தேர்வு)\s*(?:திற|open|enter|go)?/i,
    ];
    for (const pat of quizPatterns) {
      const m = t.match(pat);
      if (m) {
        const lessonName = m[1].replace(/\b(lesson|பாடம்|படம்)\b/gi,'').trim();
        const lesson = findLesson(lessonName);
        if (lesson && lesson.quizUrl) {
          return { feedback: `Opening ${lesson.title} quiz`, navigate: lesson.quizUrl };
        }
        if (lesson) return { feedback: `${lesson.title} has no quiz`, navigate: null };
      }
    }

    // ── "enter to X" / "X lesson" ─────────────────────────────────────
    const lessonPatterns = [
      /(?:enter\s+to|go\s+to|view)\s+(.+?)\s*(?:lesson|பாடம்|படம்)?$/i,
      /(.+?)\s+(?:lesson|பாடம்)\s*(?:திற|open|enter|போ|go)?/i,
      /(.+?)\s+(?:திற|enter|போ)\s*$/i,
    ];
    for (const pat of lessonPatterns) {
      const m = t.match(pat);
      if (m) {
        const lessonName = m[1]
          .replace(/\b(lesson|பாடம்|படம்|திற|open|enter|போ|go)\b/gi,'')
          .trim();
        const lesson = findLesson(lessonName);
        if (lesson) return { feedback: `Opening ${lesson.title}`, navigate: lesson.viewUrl };
      }
    }

    return null;
  }

  /* ── static command table ───────────────────────────────── */
  function buildStaticRoutes() {
    return [

      // ── CLOSE / BACK (checked first) ────────────────────
      {
        pat: [/\b(close|back|go back|மூடு|திரும்பு)\b/i],
        action() { window.history.back(); return 'Going back'; },
        label: 'Going back'
      },

      // Navigation
      {
        pat: [/\b(dashboard|home|முகப்பு|டாஷ்போர்டு)\b/i],
        action() { window.location.href = '/'; },
        label: 'Going to dashboard'
      },
      {
        pat: [/\blogin\b/i, /\bsign in\b/i, /\bஉள்நுழை\b/i],
        action() { window.location.href = '/login'; },
        label: 'Going to login'
      },
      {
        pat: [/\blogout\b/i, /\bsign out\b/i, /\bவெளியேறு\b/i],
        action() { window.location.href = '/logout'; },
        label: 'Logging out'
      },
      {
        pat: [/\bregister\b/i, /\bsign up\b/i, /\bபதிவு\b/i],
        action() { window.location.href = '/register'; },
        label: 'Going to register'
      },

      // Close / Back
      {
        pat: [/\b(close|back|go back|திரும்பு|மூடு)\b/i],
        action() { window.history.back(); },
        label: 'Going back'
      },

      // ── CORE AUDIO CONTROLS (Standalone & Phrases) ──────────────────
      {
        pat: [
          /\b(read|play|start|begin)\s*(?:the\s*)?(original text|lesson text|content)\b/i,
          /\b(original text|lesson text|old girl text|original test)\b/i,
          /\b(read|play|begin|start|படி|தொடங்கு|ஆரம்பி)\b$/i 
        ],
        action() {
          const btn = document.getElementById('btnPlay');
          if (btn) { btn.click(); return 'Starting the audio player'; }
          const content = document.getElementById('va-original-text')?.textContent;
          if (content && content.trim()) { speak(content, detectLang()); return 'Reading original lesson text'; }
          return 'No original text or play button found';
        },
        label: 'Reading original text'
      },
      {
        pat: [
          /\b(read|play|start|begin)\s*(?:the\s*)?(uploaded file|file content|pdf content|file)\b/i,
          /\b(uploaded file|file content|pdf content|file)\b/i
        ],
        action() {
          const btn = document.getElementById('btnPlayFile');
          if (btn) { btn.click(); return 'Reading the uploaded file'; }
          const lessonData = document.getElementById('lesson-data');
          if (lessonData && lessonData.dataset.fileContent) {
            speak(lessonData.dataset.fileContent, detectLang());
            return 'Reading file content';
          }
          return 'No uploaded file content found';
        },
        label: 'Reading uploaded file'
      },
      {
        pat: [/\b(who is the instructor|instructor info|read instructor|ஆசிரியர் விவரம்)\b/i, /\b(instructor name|instructor email)\b/i],
        action() {
          const name = document.getElementById('va-instructor-name')?.textContent || 'Unknown';
          const email = document.getElementById('va-instructor-email')?.textContent || 'Unknown';
          return { feedback: `The instructor is ${name}. Their email address is ${email}.`, speakOnly: true };
        },
        label: 'Reading instructor info'
      },
      {
        pat: [/\b(play|start audio|read lesson|ஆடியோ தொடங்கு|படி)\b/i],
        action() {
          const btn = document.getElementById('btnPlay');
          if (btn) { btn.click(); return 'Playing lesson audio'; }
          smartRead(); return 'Reading';
        },
        label: 'Playing audio'
      },
      {
        pat: [/\b(pause|wait|pass|இடை நிறுத்து|காத்திரு)\b/i],
        action() {
          const btn = document.getElementById('btnPause');
          if (btn) btn.click(); else synth.pause();
          return 'Paused';
        },
        label: 'Paused'
      },
      {
        pat: [/\b(download audio|get audio|ஆடியோ பதிவிறக்கம்)\b/i],
        action() {
          const link = document.querySelector('a[href*="/audio/download"]');
          if (link) return { feedback: 'Downloading lesson audio', navigate: link.href };
          return 'No audio download available here';
        },
        label: 'Downloading audio'
      },
      {
        pat: [/\b(stop|cancel|exit|end|shop|step|top|stock|stuff|spot|நிறுத்து|முடி)\b/i],
        action() {
          const btn = document.getElementById('btnStop');
          if (btn) btn.click();
          
          // ALWAYS cancel globally as a safety measure
          console.log("VA: Stopped audio globally.");
          window.speechSynthesis.cancel();
          return 'Stopped';
        },
        label: 'Stopped'
      },

      // ── DOWNLOAD COMMANDS (lesson page) ────────────────────
      {
        pat: [
          /\b(download|get|save|grab|பதிவிறக்கம்)\b.*\bbrf\b/i,
          /\bbrf\b.*\b(download|get|save|grab|பதிவிறக்கம்|file|கோப்பு)\b/i,
          /\bbraille\b.*\bbrf\b/i
        ],
        action() {
          const pd = pageData();
          if (pd.currentLesson && pd.currentLesson.brfUrl) {
            return { feedback: 'Downloading BRF file', navigate: pd.currentLesson.brfUrl };
          }
          const link = document.querySelector('a[href*="/download_brf/"]');
          if (link) return { feedback: 'Downloading BRF file', navigate: link.href };
          return 'No BRF file available here';
        },
        label: 'Downloading BRF'
      },
      // ── PDF VIEW / OPEN COMMANDS ──────────────────────────
      {
        pat: [
          /\b(view|open|show|திற)\b.*\bpdf\b/i,
          /\bpdf\b.*\b(view|open|show|திற)\b/i
        ],
        action() {
          const pd = pageData();
          if (pd.currentLesson) {
            return { feedback: 'Opening Braille PDF view', navigate: `/view_braille/${pd.currentLesson.id}` };
          }
          const link = document.querySelector('a[href*="/view_braille/"], a[href*="/view_file_braille/"]');
          if (link) return { feedback: 'Opening Braille view', navigate: link.href };
          return 'No viewable PDF found here';
        },
        label: 'Opening Braille view'
      },

      {
        pat: [
          /\b(download|get|save|grab|பதிவிறக்கம்)\b.*\bpdf\b/i,
          /\bpdf\b.*\b(download|get|save|grab|பதிவிறக்கம்)\b/i
        ],
        action() {
          const pd = pageData();
          if (pd.currentLesson && pd.currentLesson.braillePdfUrl) {
            return { feedback: 'Downloading braille PDF', navigate: pd.currentLesson.braillePdfUrl };
          }
          const link = document.querySelector('a[href*="/download_braille/"]');
          if (link) return { feedback: 'Downloading braille PDF', navigate: link.href };
          return 'No braille PDF available here';
        },
        label: 'Downloading braille PDF'
      },
      {
        pat: [
          /\b(download|get|save|grab|பதிவிறக்கம்)\b.*\bfile\b.*\bbraille\b/i,
          /\bbraille\b.*\bfile\b.*\b(download|get|save|grab|பதிவிறக்கம்)\b/i,
          /\b(file|braille)\b.*\b(download|get|save|grab|பதிவிறக்கம்)\b/i
        ],
        action() {
          const pd = pageData();
          if (pd.currentLesson && pd.currentLesson.fileBrailleUrl) {
            return { feedback: 'Downloading file braille', navigate: pd.currentLesson.fileBrailleUrl };
          }
          const link = document.querySelector('a[href*="/download_file_braille/"]');
          if (link) return { feedback: 'Downloading file braille', navigate: link.href };
          return 'No file braille available here';
        },
        label: 'Downloading file braille'
      },
      {
        pat: [
          /\b(view|open|show|காட்டு|திற)\b.*\bfile\b.*\bbraille\b/i,
          /\bfile\b.*\bbraille\b.*\b(view|open|show|காட்டு|திற)\b/i
        ],
        action() {
          const pd = pageData();
          if (pd.currentLesson && pd.currentLesson.viewFileBrailleUrl) {
            return { feedback: 'Opening file braille view', navigate: pd.currentLesson.viewFileBrailleUrl };
          }
          const link = document.querySelector('a[href*="/view_file_braille/"]');
          if (link) return { feedback: 'Opening file braille', navigate: link.href };
          return 'No file braille view available here';
        },
        label: 'Viewing file braille'
      },
      {
        pat: [/\b(download file|download original|download uploaded)\b/i],
        action() {
          const link = document.querySelector('a[download][href*="uploads"]');
          if (link) return { feedback: 'Downloading file', navigate: link.href };
          return 'No downloadable file found here';
        },
        label: 'Downloading file'
      },

      // Quiz commands (dashboard / lesson page)
      {
        pat: [/\b(take quiz|start quiz|தேர்வு எடு|quiz எடு)\b/i],
        action() {
          // on a lesson page with quiz
          const pd = pageData();
          if (pd.currentLesson && pd.currentLesson.quizUrl) {
            window.location.href = pd.currentLesson.quizUrl;
            return 'Opening quiz';
          }
          const link = document.querySelector('a[href*="/quiz/"]');
          if (link) { window.location.href = link.href; return 'Opening quiz'; }
          return 'No quiz found here';
        },
        label: 'Opening quiz'
      },
      {
        pat: [/\b(submit|finish|சமர்ப்பி)\b/i],
        action() {
          const btn = document.querySelector('button[type="submit"], input[type="submit"]');
          if (btn) { btn.click(); return 'Submitted'; }
          return 'No submit button found';
        },
        label: 'Submitted'
      },
      {
        pat: [/\b(my results|results|score|மதிப்பு)\b/i],
        action() {
          const link = document.querySelector('a[href*="results"]');
          if (link) { window.location.href = link.href; return 'Opening results'; }
          window.location.href = '/student/my-results';
        },
        label: 'Going to results'
      },

      // Create lesson (instructor)
      {
        pat: [/\b(create lesson|new lesson|பாடம் உருவாக்கு)\b/i],
        action() { window.location.href = '/instructor/lesson/create'; },
        label: 'Creating lesson'
      },

      // Read
      {
        pat: [/\b(read that|read this|பக்கம் படி|படி)\b/i],
        action() {
          const pd = pageData();
          if (pd.originalText) {
            speak(pd.originalText, detectLang());
            return 'Reading the original text for this Braille content';
          }
          return smartRead();
        },
        label: 'Reading content'
      },
      {
        pat: [/\b(read page|read out|read lessons|lessons படி)\b/i],
        action() { return smartRead(); },
        label: 'Reading'
      },

      // Theme
      {
        pat: [/\b(dark mode|dark|இருட்டு)\b/i],
        action() { if (window.toggleDarkMode) toggleDarkMode(); return 'Toggled dark mode'; },
        label: 'Dark mode toggled'
      },
      {
        pat: [/\b(light mode|light|வெளிச்சம்)\b/i],
        action() {
          document.body.classList.remove('dark-mode');
          localStorage.setItem('theme','light');
          return 'Light mode';
        },
        label: 'Light mode'
      },

      // Scroll
      {
        pat: [/\b(scroll down|கீழே)\b/i],
        action() { window.scrollBy({ top: 400, behavior: 'smooth' }); return 'Scrolled down'; },
        label: 'Scroll down'
      },
      {
        pat: [/\b(scroll up|மேலே)\b/i],
        action() { window.scrollBy({ top: -400, behavior: 'smooth' }); return 'Scrolled up'; },
        label: 'Scroll up'
      },

      // Help
      {
        pat: [/\b(help|உதவி|commands)\b/i],
        action() {
          const msg = 'Common commands: Read, Pause, Stop, Close, Open Lesson, Dashboard, Results, Help. For example, say "Open Science" or just "Read". (தமிழ் கட்டளைகள்: படி, நிறுத்து, முகப்பு, உதவி).';
          return { feedback: msg, speakOnly: true };
        },
        label: 'Help shown'
      },

      // ── QUIZ AUTOMATION (only works on quiz page) ────────────────
      {
        pat: [/\b(read question|பாடம் படி|கேள்வி படி)\b/i],
        action() {
          if (window.VA_readQuestion) { window.VA_readQuestion(); return 'Reading question'; }
          return 'No question to read here';
        },
        label: 'Reading question'
      },
      {
        pat: [/\b(next question|next|அடுத்த கேள்வி|அடுத்து)\b/i],
        action() {
          if (window.VA_goNext) { window.VA_goNext(); return 'Going to next question'; }
          return { feedback: 'Next question command not available here', speakOnly: true };
        },
        label: 'Next question'
      },
      {
        pat: [/\b(previous question|previous|முந்தைய கேள்வி|முந்தை)\b/i],
        action() {
          if (window.VA_goPrev) { window.VA_goPrev(); return 'Going to previous question'; }
          return { feedback: 'Previous question command not available here', speakOnly: true };
        },
        label: 'Previous question'
      },
      {
        pat: [/\b(answer|choose|select|விடை|தேர்ந்தெடு)\s+([a-d])\b/i, /\b([a-d])\s+(விடை|answer|choose|select)\b/i],
        action(match) {
          const letter = match[1].length === 1 ? match[1] : match[2];
          if (window.VA_answerOption) { window.VA_answerOption(letter); return 'Selected option ' + letter.toUpperCase(); }
          return 'Cannot answer here';
        },
        label: 'Answering option'
      },
      {
        pat: [/\b(submit quiz|finish quiz|சமர்ப்பி)\b/i],
        action() {
          if (window.VA_submitQuiz) { window.VA_submitQuiz(); return 'Submitting quiz'; }
          return 'No quiz to submit';
        },
        label: 'Submitting quiz'
      },
      {
        pat: [/\b(retry quiz|மீண்டும் முயற்சி)\b/i],
        action() {
          const pd = pageData();
          if (pd.page === 'quiz_result' && pd.result.retryUrl) {
            return { feedback: 'Retrying quiz', navigate: pd.result.retryUrl };
          }
          return 'No quiz to retry';
        },
        label: 'Retrying quiz'
      }
    ];
  }

  /* ── master match ────────────────────────────────────────── */
  function matchCommand(raw) {
    // A. Global Normalization: trim, lowercase, remove trailing punctuation
    const t = raw.trim().toLowerCase().replace(/[.?!]$/, '');

    // 1. Try dynamic lesson/quiz navigation first
    const dyn = matchDynamic(t);
    if (dyn) return dyn;

    // 2. Static routes (Phrase-based)
    const routes = buildStaticRoutes();
    for (const r of routes) {
      for (const p of r.pat) {
        const m = t.match(p);
        if (m) {
          const result = typeof r.action === 'function' ? r.action(m) : null;
          if (result && typeof result === 'object') return result;
          return { feedback: result || r.label, navigate: null };
        }
      }
    }

    // 3. AI-LIKE FUZZY KEYWORD FALLBACK (Intent Sensing)
    // If no exact phrase matches, search for key action words anywhere in the text.
    console.log("VA: No exact match, trying fuzzy keyword search...");
    
    const tryAction = (label) => {
        const r = routes.find(route => route.label === label);
        if (!r) return null;
        const res = r.action();
        if (res && typeof res === 'object') return res;
        return { feedback: res || r.label, navigate: null };
    };

    // Help? 
    if (t.includes('help') || t.includes('உதவி')) return tryAction('Help shown');

    // Stop/Pause (Safety/Control first)
    // 🎤 ULTRA-AGGRESSIVE sensing: Stop and Pause now trigger if the keyword is ANYWHERE in the transcript.
    if (t.includes('stop') || t.includes('நிறுத்து') || t.includes('முடி')) return tryAction('Stopped');
    if (t.includes('pause') || t.includes('pass') || t.includes('wait') || t.includes('காத்திரு')) return tryAction('Paused');
    
    // Fallback regex for phrase-like matching
    if (/\b(stop|cancel|end|shop|step|top|stock|stuff|spot)\b/i.test(t)) return tryAction('Stopped');
    if (/\b(pause|wait|pass)\b/i.test(t)) return tryAction('Paused');

    // Read/Play
    if (/\b(read|red|play|start|begin|படி|தொடங்கு|ஆரம்பி)\b/i.test(t)) {
        // Special case: "Read that" on Braille view
        if (t.includes('that')) {
            const res = tryAction('Reading content');
            if (res) return res;
        }
        return tryAction('Reading original text');
    }

    // Download
    if (/\b(download|get|save|பதிவிறக்கம்)\b/i.test(t)) {
        if (t.includes('pdf')) return tryAction('Downloading braille PDF');
        if (t.includes('brf')) return tryAction('Downloading BRF');
    }

    // Open/Go
    if (/\b(open|go to|view|திற)\b/i.test(t)) {
        if (t.includes('result')) return tryAction('Going to results');
        if (t.includes('dashboard') || t.includes('home')) return tryAction('Going to dashboard');
        
        // Try to find a lesson name in the whole string
        const lessonMatch = matchDynamic(`open ${t}`);
        if (lessonMatch) return lessonMatch;
    }

    return null;
  }

  /* ═══════════════════════════════════════════════════════════
     SPEECH RECOGNITION
  ═══════════════════════════════════════════════════════════ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let micActive = false;
  let lastError = null;

  function startListening() {
    if (!SR) { showToast('❌ Voice input not supported in this browser.', 'danger'); return; }
    if (micActive) return;

    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;
    // Always use en-US for commands — lesson names & nav words are English.
    // TTS (reading) still uses the lesson's own language.
    recognition.lang = 'en-US';
    micActive = true;
    updateMicBtn(true);
    showToast('🎙️ Listening… (speak in English)', 'info');

    recognition.onresult = (e) => {
      // In continuous mode, e.resultIndex is the index of the latest result
      const latestIdx = e.resultIndex;
      const result    = e.results[latestIdx];
      
      // Try all alternatives for best match
      let matched = null;
      let usedTranscript = '';
      for (let i = 0; i < result.length; i++) {
        const transcript = result[i].transcript;
        const m = matchCommand(transcript);
        if (m) { matched = m; usedTranscript = transcript; break; }
        if (!usedTranscript) usedTranscript = transcript; // keep first for display
      }

      showTranscript(usedTranscript);

      if (matched) {
        showToast('✅ ' + matched.feedback, 'success');
        if (matched.navigate) {
          speak(matched.feedback, detectLang(), () => {
            window.location.href = matched.navigate;
          });
        } else if (!matched.speakOnly) {
          speak(matched.feedback, detectLang());
        } else {
          // just speak (like help)
          speak(matched.feedback, 'en-US');
        }
      } else {
        const msg = `Not recognised: "${usedTranscript}". Say "help" for commands.`;
        showToast('❓ ' + msg, 'warning');
        // No speak() here to avoid annoying interruptions in Always-On mode.
      }
    };

    recognition.onerror = (e) => {
      lastError = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micActive = false;
      }
      if (e.error === 'network') {
        showToast('📡 Connection weak... Reconnecting...', 'info');
      } else if (e.error !== 'no-speech') {
        showToast('❌ Mic: ' + e.error, 'danger');
      }
    };
    recognition.onend = () => {
      // ✨ AUTO-RESTART: If micActive is true but recognition ended (e.g., timeout or network blip), 
      // restart it unless we explicitly stopped it.
      if (micActive) {
        console.log("VA: Recognition ended, auto-restarting...");
        const delay = (lastError === 'network') ? 3000 : 100; // 3sec delay for network blips
        setTimeout(() => {
          if (micActive) { // double check if still active after delay
            try { recognition.start(); } catch(e) { console.warn("VA: Restart failed", e); }
          }
        }, delay);
      } else {
        updateMicBtn(false);
      }
      lastError = null; // reset after handling restart
    };
    recognition.start();
  }

  function stopListening() {
    if (recognition && micActive) recognition.stop();
    micActive = false; updateMicBtn(false);
  }

  /* ═══════════════════════════════════════════════════════════
     WIDGET UI
  ═══════════════════════════════════════════════════════════ */
  function buildWidget() {
    const widget = document.createElement('div');
    widget.id = 'va-widget';
    widget.innerHTML = `
      <style>
        #va-widget {
          position:fixed; bottom:28px; right:28px; z-index:9999;
          display:flex; flex-direction:column; align-items:flex-end; gap:10px;
          font-family:'Inter',sans-serif;
        }
        #va-panel {
          background:linear-gradient(135deg,#1e293b,#0f172a);
          border:1px solid rgba(59,130,246,.35); border-radius:18px;
          padding:16px 20px; width:330px;
          box-shadow:0 16px 48px rgba(0,0,0,.5);
          display:none; animation:va-up .25s ease;
        }
        @keyframes va-up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        #va-panel h6 { color:#93c5fd; font-size:.72rem; letter-spacing:.1em; text-transform:uppercase; margin-bottom:10px; }
        .va-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:9px; }
        .va-btn {
          flex:1; min-width:56px; padding:8px 10px;
          border:none; border-radius:10px; font-size:.78rem; font-weight:600;
          cursor:pointer; transition:transform .15s,box-shadow .15s; white-space:nowrap;
        }
        .va-btn:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,.35); }
        .va-btn.read  { background:linear-gradient(135deg,#059669,#10b981); color:#fff; }
        .va-btn.pause { background:linear-gradient(135deg,#d97706,#f59e0b); color:#fff; }
        .va-btn.stop  { background:linear-gradient(135deg,#dc2626,#ef4444); color:#fff; }
        .va-btn.mic   { background:linear-gradient(135deg,#7c3aed,#8b5cf6); color:#fff; }
        .va-btn.mic.active { background:linear-gradient(135deg,#be123c,#f43f5e); animation:va-pulse 1s infinite; }
        .va-btn.back  { background:linear-gradient(135deg,#334155,#475569); color:#fff; }
        @keyframes va-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(244,63,94,.5)} 50%{box-shadow:0 0 0 8px rgba(244,63,94,0)} }

        /* Lesson chips area */
        #va-lesson-chips { margin-bottom:9px; display:none; }
        #va-lesson-chips p { color:#94a3b8; font-size:.66rem; margin-bottom:5px; }
        .va-lesson-chip {
          display:inline-block; background:rgba(16,185,129,.15); color:#6ee7b7;
          border:1px solid rgba(16,185,129,.3); border-radius:20px;
          padding:2px 10px; font-size:.67rem; cursor:pointer; margin:2px;
          transition:background .2s;
        }
        .va-lesson-chip:hover { background:rgba(16,185,129,.3); }
        .va-lesson-chip.quiz-chip { background:rgba(139,92,246,.15); color:#c4b5fd; border-color:rgba(139,92,246,.3); }
        .va-lesson-chip.quiz-chip:hover { background:rgba(139,92,246,.3); }

        #va-transcript {
          background:rgba(255,255,255,.07); border-radius:8px;
          padding:8px 10px; color:#e2e8f0; font-size:.78rem;
          min-height:30px; margin-top:4px; word-break:break-word;
        }
        #va-transcript span { color:#60a5fa; }

        /* Static hint pills */
        #va-hints { margin-top:9px; display:flex; flex-wrap:wrap; gap:5px; }
        .va-hint {
          background:rgba(59,130,246,.18); color:#93c5fd;
          border-radius:20px; padding:2px 9px; font-size:.67rem;
          cursor:pointer; border:1px solid rgba(59,130,246,.3); transition:background .2s;
        }
        .va-hint:hover { background:rgba(59,130,246,.35); }

        /* FAB */
        #va-fab {
          width:58px; height:58px; border-radius:50%;
          background:linear-gradient(135deg,#3b82f6,#6366f1);
          border:none; cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          font-size:1.5rem; box-shadow:0 8px 24px rgba(99,102,241,.55);
          transition:transform .2s, box-shadow .2s;
        }
        #va-fab:hover { transform:scale(1.12) translateY(-2px); box-shadow:0 12px 32px rgba(99,102,241,.7); }

        /* Toast */
        #va-toast {
          position:fixed; bottom:110px; right:28px; z-index:10000;
          max-width:320px; border-radius:12px; padding:12px 18px;
          font-size:.82rem; font-weight:500; color:#fff;
          box-shadow:0 8px 24px rgba(0,0,0,.3); display:none;
          animation:va-up .2s ease;
        }
        #va-toast.info    { background:linear-gradient(135deg,#0ea5e9,#38bdf8); }
        #va-toast.success { background:linear-gradient(135deg,#059669,#10b981); }
        #va-toast.warning { background:linear-gradient(135deg,#d97706,#f59e0b); }
        #va-toast.danger  { background:linear-gradient(135deg,#dc2626,#ef4444); }
      </style>

      <div id="va-toast"></div>

      <div id="va-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h6 style="margin:0;">🔊 Voice Assistant</h6>
          <span style="font-size:0.6rem; color:#94a3b8; font-family:monospace; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; border:1px solid rgba(255,255,255,0.1);">Space: Mic | S: Stop | P: Pause | R: Read</span>
        </div>

        <div class="va-row">
          <button class="va-btn read"  onclick="vaRead()">▶ Read</button>
          <button class="va-btn pause" onclick="vaPause()">⏸ Pause</button>
          <button class="va-btn stop"  onclick="vaStop()">⏹ Stop</button>
          <button class="va-btn back"  onclick="runHint('close')">← Back</button>
        </div>
        <div class="va-row">
          <button id="va-mic-btn" class="va-btn mic" onclick="vaToggleMic()">🎙️ Voice Command</button>
        </div>

        <!-- Dynamic lesson chips (populated from VA_PAGE_DATA) -->
        <div id="va-lesson-chips">
          <p>📚 Quick open a lesson:</p>
          <div id="va-lesson-chips-inner"></div>
        </div>

        <div id="va-transcript"><span>Say a command…</span></div>
        <div id="va-hints">
          <span class="va-hint" onclick="runHint('read lessons')">📚 read</span>
          <span class="va-hint" onclick="runHint('close')">← close</span>
          <span class="va-hint" onclick="runHint('dashboard')">🏠 home</span>
          <span class="va-hint" onclick="runHint('take quiz')">🧠 quiz</span>
          <span class="va-hint" onclick="runHint('my results')">📊 results</span>
          <span class="va-hint" onclick="runHint('download brf file')">⬇ BRF</span>
          <span class="va-hint" onclick="runHint('download braille pdf')">⬇ PDF</span>
          <span class="va-hint" onclick="runHint('download file braille')">⬇ File Braille</span>
          <span class="va-hint" onclick="runHint('play')">▶ play</span>
          <span class="va-hint" onclick="runHint('dark mode')">🌙 dark</span>
          <span class="va-hint" onclick="runHint('scroll down')">⬇ scroll</span>
          <span class="va-hint" onclick="runHint('help')">❓ help</span>
        </div>
      </div>

      <button id="va-fab" onclick="vaTogglePanel()" title="Voice Assistant">🎤</button>
    `;
    document.body.appendChild(widget);
    buildLessonChips();
  }

  /* ─── build lesson quick-chips from VA_PAGE_DATA ─────────── */
  function buildLessonChips() {
    const pd = pageData();
    const lessons = pd.lessons || [];
    if (!lessons.length) return;

    const container = document.getElementById('va-lesson-chips');
    const inner     = document.getElementById('va-lesson-chips-inner');
    if (!container || !inner) return;

    container.style.display = 'block';
    lessons.forEach(l => {
      // View chip
      const chip = document.createElement('span');
      chip.className = 'va-lesson-chip';
      chip.textContent = '📖 ' + l.title;
      chip.onclick = () => {
        showTranscript('open ' + l.title);
        showToast('✅ Opening ' + l.title, 'success');
        speak('Opening ' + l.title, detectLang(), () => {
          window.location.href = l.viewUrl;
        });
      };
      inner.appendChild(chip);

      // Quiz chip (if available)
      if (l.quizUrl) {
        const qchip = document.createElement('span');
        qchip.className = 'va-lesson-chip quiz-chip';
        qchip.textContent = '🧠 ' + l.title + ' Quiz';
        qchip.onclick = () => {
          showTranscript('open ' + l.title + ' quiz');
          showToast('✅ Opening ' + l.title + ' quiz', 'success');
          speak('Opening ' + l.title + ' quiz', detectLang(), () => {
            window.location.href = l.quizUrl;
          });
        };
        inner.appendChild(qchip);
      }
    });
  }

  /* ─── panel toggle ──────────────────────────────────────── */
  let panelOpen = false;
  window.vaTogglePanel = function () {
    panelOpen = !panelOpen;
    document.getElementById('va-panel').style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) showToast('🔊 Voice Assistant ready!', 'info', 1800);
  };

  /* ─── button actions ────────────────────────────────────── */
  window.vaRead   = function () {
    const btn = document.getElementById('btnPlay');
    if (btn) {
      btn.click();
      showToast('▶ Reading/Resuming...', 'success');
    } else {
      const r = smartRead();
      showToast('▶ ' + r, 'success');
    }
  };
  window.vaPause  = function () {
    const btn = document.getElementById('btnPause');
    if (btn) {
      btn.click();
    } else {
      synth.pause();
    }
    showToast('⏸ Paused', 'warning');
  };
  window.vaStop   = function () {
    stopSpeaking();
    const btn = document.getElementById('btnStop');
    if (btn) {
        btn.click();
    }
    showToast('⏹ Stopped', 'danger');
  };
  window.vaToggleMic = function () {
    if (micActive) stopListening(); else startListening();
  };

  function updateMicBtn(active) {
    const btn = document.getElementById('va-mic-btn');
    if (!btn) return;
    btn.classList.toggle('active', active);
    btn.textContent = active ? '🔴 Listening…' : '🎙️ Voice Command';
  }

  function showTranscript(text) {
    const el = document.getElementById('va-transcript');
    if (el) el.innerHTML = `<span>You said:</span> "${text}"`;
  }

  let toastTimer = null;
  function showToast(msg, type, duration) {
    duration = duration || 3200;
    const el = document.getElementById('va-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = type || 'info';
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, duration);
  }

  /* run a text command (used by hint chips & lesson chips) */
  window.runHint = function (text) {
    showTranscript(text);
    const m = matchCommand(text);
    if (m) {
      showToast('✅ ' + m.feedback, 'success');
      if (m.navigate) {
        speak(m.feedback, detectLang(), () => { window.location.href = m.navigate; });
      } else if (!m.speakOnly) {
        speak(m.feedback, detectLang());
      } else {
        speak(m.feedback, 'en-US');
      }
    }
  };

  /* ── Init ───────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', buildWidget);

  // Stop TTS if user navigates away from the page
  window.addEventListener('beforeunload', function() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  });

  // ── Keyboard Shortcut: Space ──
  document.addEventListener('keydown', function(e) {
    // Only trigger if not in a text box
    const tag = e.target.tagName.toLowerCase();
    const isEditing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if (isEditing) return;

    const key = e.key.toLowerCase();
    
    // Space: Toggle Mic
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      vaToggleMic();
    } 
    // S or Escape: Stop
    else if (key === 's' || e.key === 'Escape') {
      vaStop();
    }
    // P: Pause
    else if (key === 'p') {
      vaPause();
    }
    // R: Read
    else if (key === 'r') {
      vaRead();
    }
  });

})();
