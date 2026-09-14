/* 我的工作台 · 手机版
   数据分两层：① 长期数据（课表/DDL/习惯）存在 localStorage['wb.db.v2']
                ② 每天的状态（打卡/复盘）存在 localStorage['wb.daily.v2']
   电脑关机也能用：整站是静态文件，手机上离线也能打开。 */
(function () {
  'use strict';

  var LS_DB = 'wb.db.v2', LS_DAILY = 'wb.daily.v2', LS_SEEN = 'wb.seen.v1';
  var DOW_CN = ['一', '二', '三', '四', '五', '六', '日'];
  var APP_VERSION = 'v5.1 · 2026-09-14';
  var CLOUD_DATA = 'd-7f3a9c2e.json';

  /* ---------------- 小工具 ---------------- */
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var dateCN = function (d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
  var dowOf = function (d) { return d.getDay() === 0 ? 7 : d.getDay(); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s), bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }
  function b64ToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s);
    return Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
  }
  function markSeen() { try { localStorage.setItem(LS_SEEN, '1'); } catch (e) { } }
  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } }
  /* 导入链接：#d=明文 或 #z=压缩（链接短很多，微信里不会被截断） */
  /* 一段文字 → 数据：支持完整链接、只粘 #z=/#d= 那串、或直接粘 JSON */
  async function parsePayload(txt) {
    txt = String(txt || '').trim();
    if (!txt) return null;
    if (txt.charAt(0) === '{') { try { return JSON.parse(txt); } catch (e) { return null; } }
    var m = txt.match(/([dz])=([A-Za-z0-9\-_]+)/);
    if (!m) return null;
    try {
      if (m[1] === 'd') return JSON.parse(b64decode(m[2]));
      if (typeof DecompressionStream !== 'function') return null;
      var stream = new Blob([b64ToBytes(m[2])]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      var buf = await new Response(stream).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    } catch (e) { return null; }
  }
  async function readHash() {
    if (!location.hash) return null;
    return parsePayload(location.hash);
  }
  function applyData(obj, msg) {
    DB = obj; saveDB(DB); markSeen(); seenWeek = 'cur';
    toast(msg || '数据已更新'); render();
  }
  async function makeLink() {
    var json = JSON.stringify(DB), base = location.origin + location.pathname;
    try {
      if (typeof CompressionStream === 'function') {
        var st = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        var buf = await new Response(st).arrayBuffer(), bin = '';
        new Uint8Array(buf).forEach(function (b) { bin += String.fromCharCode(b); });
        return base + '#z=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    } catch (e) { }
    return base + '#d=' + b64encode(json);
  }

  /* ---------------- 数据读写 ---------------- */
  var DEMO = clone(window.DEMO_DATA);
  var DB = loadDB();
  var tab = 'today', seenWeek = 'cur';

  function loadDB() {
    var raw = null;
    try { raw = localStorage.getItem(LS_DB); } catch (e) { }
    if (raw) { try { return JSON.parse(raw); } catch (e) { } }
    return clone(DEMO);
  }
  function saveDB(o) {
    try { localStorage.setItem(LS_DB, JSON.stringify(o || DB)); } catch (e) { }
  }
  function loadDaily() {
    try { return JSON.parse(localStorage.getItem(LS_DAILY) || '{}'); } catch (e) { return {}; }
  }
  function saveDaily(o) {
    try { localStorage.setItem(LS_DAILY, JSON.stringify(o)); } catch (e) { }
  }
  function today(key) {
    var D = loadDaily();
    if (!D[key]) D[key] = { tasks: (DB.tasks || []).map(function (t) { return { t: t, done: false }; }), habits: {}, review: '' };
    if (!D[key].tasks) D[key].tasks = [];
    if (!D[key].habits) D[key].habits = {};
    return D[key];
  }
  function isFirstRun() {
    try { return !localStorage.getItem(LS_SEEN); } catch (e) { return false; }
  }

  /* ---------------- 学期周次 / 课程 ---------------- */
  function weekNumber(d) {
    var w1 = DB.term && DB.term.week1Monday;
    if (!w1) return null;
    var a = new Date(w1 + 'T00:00:00');
    if (isNaN(a.getTime())) return null;
    a = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((b - a) / 86400000);
    if (diff < 0) return 0;
    return Math.floor(diff / 7) + 1;
  }
  function weekIn(range, week) {
    if (!range || week == null) return true;
    var m = String(range).match(/(\d+)\s*[-~至]\s*(\d+)/);
    if (!m) return true;
    return week >= +m[1] && week <= +m[2];
  }
  function coursesOn(dow, week) {
    var list = (DB.schedule && DB.schedule[String(dow)]) || [];
    return list.filter(function (c) {
      if (!weekIn(c.weeks, week)) return false;
      if (c.odd && week % 2 === 0) return false;
      if (c.even && week % 2 === 1) return false;
      return true;
    }).slice().sort(function (a, b) { return a.from - b.from; });
  }
  function pstart(i) {
    var p = (DB.periods || [])[i - 1];
    if (!p) return null;
    var t = String(p).split('-')[0].match(/(\d{1,2})\D+(\d{2})/);
    return t ? +t[1] * 60 + +t[2] : null;
  }
  function pend(i) {
    var p = (DB.periods || [])[i - 1];
    if (!p) return null;
    var e = String(p).split('-')[1] || p;
    var t = e.match(/(\d{1,2})\D+(\d{2})/);
    return t ? +t[1] * 60 + +t[2] : null;
  }
  function spanText(from, to) {
    var a = (DB.periods || [])[from - 1], b = (DB.periods || [])[to - 1];
    if (!a || !b) return '';
    var s = String(a).split('-')[0], e = String(b).split('-')[1] || '';
    return s + (e ? '–' + e : '');
  }
  function timeLabel(c) {
    return c.from === c.to ? '第' + c.from + '节' : '第' + c.from + '-' + c.to + '节';
  }
  function weekLabel(c) {
    var s = c.weeks ? '第' + c.weeks + '周' : '';
    if (c.odd) s += '（单周）';
    if (c.even) s += '（双周）';
    return s;
  }
  function daysLeft(due) {
    if (!due) return null;
    var t = new Date(ymd(new Date()) + 'T00:00:00'), d = new Date(due + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.round((d - t) / 86400000);
  }
  function leftChip(n) {
    if (n == null) return '<span class="left tbd">待定</span>';
    if (n < 0) return '<span class="left tbd">已过 ' + (-n) + ' 天</span>';
    if (n === 0) return '<span class="left urgent">今天</span>';
    var cls = n <= 3 ? 'urgent' : (n <= 10 ? 'soon' : '');
    return '<span class="left ' + cls + '">还有 ' + n + ' 天</span>';
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._h); toast._h = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  /* ---------------- 视图：今日 ---------------- */
  function viewToday() {
    var now = new Date(), key = ymd(now), dow = dowOf(now), wk = weekNumber(now);
    var day = today(key);
    var list = coursesOn(dow, wk);
    var mins = now.getHours() * 60 + now.getMinutes();

    var nowCourse = null, nextCourse = null;
    list.forEach(function (c) {
      var s = pstart(c.from), e = pend(c.to);
      c._s = s; c._e = e;
      if (s != null && e != null && mins >= s && mins < e) nowCourse = c;
      else if (s != null && mins < s && !nextCourse) nextCourse = c;
    });

    var chips = [];
    chips.push('<span class="chip gray">' + (wk ? '第 ' + wk + ' 周' : '未设开学日期') + '</span>');
    if (nowCourse) chips.push('<span class="chip">正在上：' + esc(nowCourse.name) + ' · 还有 ' + (nowCourse._e - mins) + ' 分钟下课</span>');
    else if (nextCourse) chips.push('<span class="chip">距 ' + esc(nextCourse.name) + ' 还有 ' + (nextCourse._s - mins) + ' 分钟</span>');
    else if (list.length) chips.push('<span class="chip gray">今天的课都上完了</span>');
    else chips.push('<span class="chip gray">今天没课</span>');

    var doneN = day.tasks.filter(function (t) { return t.done; }).length;
    var pct = day.tasks.length ? Math.round(doneN / day.tasks.length * 100) : 0;

    var h = '';
    h += '<div class="head"><div><div class="date">' + dateCN(now) + ' 周' + DOW_CN[dow - 1] + ' · ' + esc((DB.term && DB.term.name) || '') + '</div>'
      + '<h1>' + esc(DB.greeting || '你好') + '，' + esc(DB.student || '') + '</h1></div></div>';
    h += '<div class="chips">' + chips.join('') + '</div>';
    if (isFirstRun()) h += '<div class="banner">这是示例数据。把工作台链接发到微信「文件传输助手」，用手机点开即可把你的课表存进这台手机。</div>';

    h += '<div class="card"><h2>今日课程</h2>';
    if (!list.length) {
      h += '<div class="empty">' + (wk === 0 ? '还没开学，先按计划走。' : '今天没有课，把时间留给自己。') + '</div>';
    } else {
      list.forEach(function (c) {
        var cls = (nowCourse === c) ? 'course now' : 'course';
        var badge = (nowCourse === c) ? '<span class="badge">进行中</span>' : (nextCourse === c ? '<span class="badge soft">下一节</span>' : '');
        var t = spanText(c.from, c.to);
        h += '<div class="' + cls + '"><div class="time"><b>' + timeLabel(c) + '</b>' + (t ? t : '') + '</div>'
          + '<div><div class="name">' + esc(c.name)
          + (c.place ? ' <span class="where">' + esc(c.place) + '</span>' : '') + badge + '</div>'
          + '<div class="place">' + (c.teacher ? esc(c.teacher) : '') + (weekLabel(c) ? (c.teacher ? ' · ' : '') + weekLabel(c) : '') + '</div></div></div>';
      });
    }
    var tmr = new Date(now.getTime() + 86400000);
    var tmrList = coursesOn(dowOf(tmr), weekNumber(tmr));
    h += '<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:9px" class="mini">'
      + '明天 周' + DOW_CN[dowOf(tmr) - 1] + '：' + (tmrList.length
        ? tmrList.map(function (c) { return timeLabel(c) + ' ' + esc(c.name) + '（' + esc(c.place || '') + '）'; }).join('；')
        : '没课') + '</div>';
    h += '</div>';

    h += '<div class="card"><h2>今天的三件要事</h2>';
    h += '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="meta"><span>' + doneN + ' / ' + day.tasks.length + ' 完成</span><span>' + pct + '%</span></div>';
    day.tasks.forEach(function (t, i) {
      h += '<button class="task' + (t.done ? ' done' : '') + '" data-act="task" data-i="' + i + '">'
        + '<span class="check">' + (t.done ? '✓' : '') + '</span><span class="t">' + esc(t.t) + '</span>'
        + '<span class="del" data-act="delTask" data-i="' + i + '">×</span></button>';
    });
    if (!day.tasks.length) h += '<div class="empty">今天还没写要事。</div>';
    h += '<div class="addrow"><input id="newTask" placeholder="加一条要事…" autocomplete="off"><button data-act="addTask">加</button></div>';
    h += '</div>';

    var undone = [];
    (DB.ddl || []).forEach(function (d, i) { if (!d.done) undone.push({ d: d, i: i }); });
    undone.sort(function (a, b) {
      if (!a.d.due && !b.d.due) return a.i - b.i;
      if (!a.d.due) return 1;
      if (!b.d.due) return -1;
      return a.d.due < b.d.due ? -1 : 1;
    });
    var ddls = undone.slice(0, 5);
    if (ddls.length) {
      h += '<div class="card"><h2>待办（' + undone.length + ' 件没做完）</h2>';
      ddls.forEach(function (o) {
        var d = o.d;
        h += '<div class="row"><div><div class="title">' + esc(d.title) + '</div>'
          + '<div class="sub">' + (d.due ? esc(d.due) : '日期待定') + (d.note ? ' · ' + esc(d.note) : '') + '</div></div>'
          + '<div style="display:flex;align-items:center;gap:8px">' + leftChip(daysLeft(d.due))
          + '<button class="del" data-act="ddlDone" data-i="' + o.i + '" title="完成">✓</button></div></div>';
      });
      if (undone.length > ddls.length) h += '<div class="mini">还有 ' + (undone.length - ddls.length) + ' 件在「任务」页</div>';
      h += '</div>';
    }

    var cds = (DB.countdown || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 3);
    if (cds.length) {
      h += '<div class="card"><h2>倒计时</h2>';
      cds.forEach(function (c) {
        var n = daysLeft(c.date);
        h += '<div class="row"><div><div class="title">' + esc(c.title) + '</div><div class="sub">' + esc(c.date) + '</div></div>'
          + '<span class="left ' + (n != null && n <= 3 ? 'urgent' : '') + '">' + (n != null ? n + ' 天' : '—') + '</span></div>';
      });
      h += '</div>';
    }

    h += '<div class="card"><h2>习惯打卡</h2><div class="habits">';
    (DB.habits || []).forEach(function (n) {
      h += '<button class="habit' + (day.habits[n] ? ' on' : '') + '" data-act="habit" data-n="' + esc(n) + '">' + esc(n) + (day.habits[n] ? ' ✓' : '') + '</button>';
    });
    if (!(DB.habits || []).length) h += '<div class="empty">还没有设置习惯。</div>';
    h += '</div></div>';

    h += '<div class="card"><h2>今日复盘</h2><textarea id="review" placeholder="今天做成了什么？哪里卡住了？">' + esc(day.review || '') + '</textarea>'
      + '<div class="actions"><button class="btn small" data-act="copyReview">复制复盘</button><button class="btn small" data-act="saveReview">保存</button></div></div>';

    if (DB.motto) h += '<footer>「' + esc(DB.motto) + '」</footer>';
    return h;
  }

  /* ---------------- 视图：课表 ---------------- */
  function viewWeek() {
    var now = new Date(), wkNow = weekNumber(now);
    var wk = seenWeek === 'all' ? null : (seenWeek === 'cur' ? wkNow : seenWeek);
    var h = '<div class="head"><div><div class="date">' + esc((DB.term && DB.term.name) || '') + '</div><h1>课表</h1></div></div>';
    h += '<div class="chips"><button class="chip' + (wk == null ? '' : ' gray') + '" data-act="wk" data-v="all">全部</button>';
    var opts = [];
    var w = wkNow || 1;
    for (var i = Math.max(1, w - 1); i <= Math.min((DB.term && DB.term.totalWeeks) || 18, w + 2); i++) opts.push(i);
    opts.forEach(function (n) {
      h += '<button class="chip' + (n === wk ? '' : ' gray') + '" data-act="wk" data-v="' + n + '">第 ' + n + ' 周' + (n === wkNow ? ' · 本周' : '') + '</button>';
    });
    h += '</div>';
    var total = 0, probe = 0;
    for (var p = 1; p <= 5; p++) probe += coursesOn(p, wk).length;
    if (wk == null) h += '<div class="banner">显示全部课程（含单双周），单双周标记在每节课下面。</div>';
    else if (!probe) h += '<div class="banner">第 ' + wk + ' 周还没有排课' + (wk === 1 ? '（多数课程从第 2 周开始）' : '') + '，点上面的「全部」能看到整学期。</div>';
    for (var d = 1; d <= 7; d++) {
      var list = coursesOn(d, wk);
      total += list.length;
      var isToday = d === dowOf(now);
      h += '<div class="day' + (isToday ? ' today' : '') + '"><h3>周' + DOW_CN[d - 1] + (isToday ? '<span class="d">· 今天</span>' : '') + (list.length ? '<span class="d">' + list.length + ' 节次</span>' : '') + '</h3>';
      if (!list.length) h += '<div class="empty">没课</div>';
      list.forEach(function (c) {
        var t = spanText(c.from, c.to);
        h += '<div class="lesson"><div class="n">' + esc(c.name)
          + (c.place ? ' <span class="where">' + esc(c.place) + '</span>' : '') + '</div>'
          + '<div class="m">' + timeLabel(c) + (t ? ' ' + t : '') + (c.teacher ? ' · ' + esc(c.teacher) : '') + (weekLabel(c) ? ' · ' + weekLabel(c) : '') + '</div></div>';
      });
      h += '</div>';
    }
    if (!total && wk == null) h += '<div class="empty">这一周没有课。</div>';
    h += '<footer>作息时间按学院推荐课表填写，可在「设置」里改。</footer>';
    return h;
  }

  /* ---------------- 视图：任务 ---------------- */
  function viewTask() {
    var h = '<div class="head"><div><div class="date">按截止时间排好</div><h1>任务与 DDL</h1></div></div>';
    var list = (DB.ddl || []).slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!a.due) return 1; if (!b.due) return -1; return a.due < b.due ? -1 : 1;
    });
    h += '<div class="card"><h2>DDL（截止事项）</h2>';
    if (!list.length) h += '<div class="empty">还没有 DDL。加一条，别靠脑子记。</div>';
    list.forEach(function (d, i) {
      var idx = DB.ddl.indexOf(d);
      h += '<div class="row"><div><div class="title' + (d.done ? ' done' : '') + '" style="' + (d.done ? 'text-decoration:line-through;color:var(--ink2)' : '') + '">' + esc(d.title) + '</div>'
        + '<div class="sub">' + (d.due ? esc(d.due) : '日期待定') + (d.note ? ' · ' + esc(d.note) : '') + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:8px">' + leftChip(daysLeft(d.due))
        + '<button class="del" data-act="ddlDone" data-i="' + idx + '" title="完成">' + (d.done ? '↺' : '✓') + '</button>'
        + '<button class="del" data-act="ddlDel" data-i="' + idx + '">×</button></div></div>';
    });
    h += '<div class="addrow"><input id="ddlTitle" placeholder="新 DDL 名称…"><input id="ddlDue" type="date" style="flex:0 0 140px"><button data-act="ddlAdd">加</button></div>';
    h += '<div class="mini">没有截止日期就先空着，之后点日期补上。</div></div>';

    var cds = (DB.countdown || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    h += '<div class="card"><h2>倒计时</h2>';
    if (!cds.length) h += '<div class="empty">比如四级、考试周、回家买票。</div>';
    cds.forEach(function (c) {
      var idx = DB.countdown.indexOf(c), n = daysLeft(c.date);
      h += '<div class="row"><div><div class="title">' + esc(c.title) + '</div><div class="sub">' + esc(c.date) + '</div></div>'
        + '<div style="display:flex;align-items:center;gap:8px"><span class="left ' + (n != null && n <= 3 ? 'urgent' : '') + '">' + (n != null ? n + ' 天' : '—') + '</span>'
        + '<button class="del" data-act="cdDel" data-i="' + idx + '">×</button></div></div>';
    });
    h += '<div class="addrow"><input id="cdTitle" placeholder="倒计时名称…"><input id="cdDate" type="date" style="flex:0 0 140px"><button data-act="cdAdd">加</button></div></div>';

    h += '<div class="card"><h2>默认的三件要事</h2><textarea id="taskTpl">' + esc((DB.tasks || []).join('\n')) + '</textarea>'
      + '<div class="mini">每天打开工作台时，会用这份清单生成当天的要事（一天一行）。</div>'
      + '<div class="actions"><button class="btn small primary" data-act="saveTpl">保存模板</button></div></div>';
    return h;
  }

  /* ---------------- 视图：设置 ---------------- */
  function viewSetup() {
    var t = DB.term || {};
    var h = '<div class="head"><div><div class="date">改完立刻生效</div><h1>设置</h1></div></div>';
    h += '<div class="card"><h2>基本</h2>'
      + '<div class="mini">名字</div><input id="sName" value="' + esc(DB.student || '') + '">'
      + '<div class="mini">问候语</div><input id="sGreet" value="' + esc(DB.greeting || '') + '">'
      + '<div class="mini">每天看的一句话</div><input id="sMotto" value="' + esc(DB.motto || '') + '">'
      + '<div class="mini">学期名称</div><input id="sTerm" value="' + esc(t.name || '') + '">'
      + '<div class="mini">开学第一周的周一（用来算"第几周"）</div><input id="sW1" type="date" value="' + esc(t.week1Monday || '') + '">'
      + '<div class="mini">总周数</div><input id="sTotal" type="number" value="' + esc(t.totalWeeks || 17) + '">'
      + '<div class="actions"><button class="btn small primary" data-act="saveBasic">保存</button></div></div>';

    h += '<div class="card"><h2>习惯（一行一个）</h2><textarea id="sHabits">' + esc((DB.habits || []).join('\n')) + '</textarea>'
      + '<div class="actions"><button class="btn small primary" data-act="saveHabits">保存</button></div></div>';

    h += '<div class="card"><h2>作息时间（一节一行）</h2><textarea id="sPeriods">' + esc((DB.periods || []).join('\n')) + '</textarea>'
      + '<div class="mini">格式：08:00-08:50。共 11 行，对应第 1～11 节。</div>'
      + '<div class="actions"><button class="btn small primary" data-act="savePeriods">保存</button></div></div>';

    h += '<div class="card"><h2>数据</h2>'
      + '<div class="mini">导出的 JSON 就是你的全部数据（课表＋DDL＋习惯）。换手机时在新手机上导入即可。</div>'
      + '<textarea id="jsonBox" style="min-height:130px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px">' + esc(JSON.stringify(DB, null, 1)) + '</textarea>'
      + '<div class="actions"><button class="btn small primary" data-act="applyJson">应用这段 JSON</button>'
      + '<button class="btn small" data-act="copyLink">复制导入链接</button>'
      + '<button class="btn small" data-act="download">导出文件</button>'
      + '<button class="btn small" data-act="reset">恢复示例数据</button></div></div>';

    h += '<div class="card"><h2>换设备 / 换图标后取回数据</h2>'
      + '<div class="mini">iPhone 上「主屏图标」和「Safari」是两套独立存储：在 Safari 里导入的数据，<br>'
      + '从主屏图标打开时可能看不到。用下面任意一种方式取回一次就好。</div>'
      + '<div class="actions"><button class="btn small primary" data-act="fetchCloud">从云端取回我的数据</button></div>'
      + '<div class="mini">或者把导入链接／数据粘进下面的框（只粘 <b>z=</b> 后面那一大串也可以）：</div>'
      + '<textarea id="pasteBox" style="min-height:70px;font-family:ui-monospace,Menlo,monospace;font-size:12px" placeholder="把链接或数据粘到这里"></textarea>'
      + '<div class="actions"><button class="btn small" data-act="applyPaste">导入这段内容</button></div></div>';

    h += '<div class="card"><h2>版本</h2>'
      + '<div class="mini">当前版本：<b>' + APP_VERSION + '</b></div>'
      + '<div class="mini">界面看起来还是旧的样子（少了某个刚加的功能）就点下面这个，它会清掉缓存重新加载。</div>'
      + '<div class="mini">这个按钮连老地址（/workbench/）的缓存一起清，清完主屏幕上旧图标也能跳到新地址。</div>'
      + '<div class="actions"><button class="btn small primary" data-act="forceUpdate">强制更新到最新版</button></div></div>';

    h += '<footer>数据只存在这台手机的浏览器里，不会上传到任何服务器。<br>手机浏览器菜单里选「添加到主屏幕」，就能像 App 一样打开。<br>当前版本 ' + APP_VERSION + '</footer>';
    return h;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var v = document.getElementById('view');
    v.innerHTML = tab === 'today' ? viewToday() : tab === 'week' ? viewWeek() : tab === 'task' ? viewTask() : viewSetup();
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    window.scrollTo(0, 0);
  }
  function rerender() { render(); }

  /* ---------------- 事件 ---------------- */
  document.getElementById('tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.getAttribute('data-tab');
    render();
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var key = ymd(new Date());

    if (act === 'task') {
      var D = loadDaily(); var day = today(key);
      var i = +el.getAttribute('data-i');
      day.tasks[i].done = !day.tasks[i].done;
      D[key] = day; saveDaily(D); rerender();
    } else if (act === 'delTask') {
      e.stopPropagation();
      var D2 = loadDaily(); var d2 = today(key);
      d2.tasks.splice(+el.getAttribute('data-i'), 1);
      D2[key] = d2; saveDaily(D2); rerender();
    } else if (act === 'addTask') {
      var inp = document.getElementById('newTask');
      var txt = (inp.value || '').trim();
      if (!txt) return;
      var D3 = loadDaily(), d3 = today(key);
      d3.tasks.push({ t: txt, done: false });
      D3[key] = d3; saveDaily(D3); rerender();
    } else if (act === 'habit') {
      var D4 = loadDaily(), d4 = today(key), n = el.getAttribute('data-n');
      d4.habits[n] = !d4.habits[n];
      D4[key] = d4; saveDaily(D4); rerender();
    } else if (act === 'copyReview' || act === 'saveReview') {
      var D5 = loadDaily(), d5 = today(key);
      d5.review = document.getElementById('review').value;
      D5[key] = d5; saveDaily(D5);
      if (act === 'copyReview') copyText(d5.review || '', '复盘已复制');
      else toast('已保存');
    } else if (act === 'wk') {
      var v = el.getAttribute('data-v');
      seenWeek = (v === 'all') ? 'all' : +v;
      rerender();
    } else if (act === 'ddlAdd') {
      var ti = (document.getElementById('ddlTitle').value || '').trim();
      if (!ti) { toast('先写名称'); return; }
      DB.ddl = DB.ddl || [];
      DB.ddl.push({ due: document.getElementById('ddlDue').value || '', title: ti, note: '', done: false });
      saveDB(); rerender();
    } else if (act === 'ddlDel') {
      DB.ddl.splice(+el.getAttribute('data-i'), 1); saveDB(); rerender();
    } else if (act === 'ddlDone') {
      var it = DB.ddl[+el.getAttribute('data-i')]; it.done = !it.done;
      if (it.done) it.note = (it.note || '') ; saveDB(); rerender();
    } else if (act === 'cdAdd') {
      var ct = (document.getElementById('cdTitle').value || '').trim();
      var cd = document.getElementById('cdDate').value;
      if (!ct || !cd) { toast('名称和日期都要填'); return; }
      DB.countdown = DB.countdown || [];
      DB.countdown.push({ date: cd, title: ct }); saveDB(); rerender();
    } else if (act === 'cdDel') {
      DB.countdown.splice(+el.getAttribute('data-i'), 1); saveDB(); rerender();
    } else if (act === 'saveTpl') {
      DB.tasks = document.getElementById('taskTpl').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      saveDB(); toast('模板已保存');
    } else if (act === 'saveBasic') {
      DB.student = document.getElementById('sName').value.trim();
      DB.greeting = document.getElementById('sGreet').value.trim();
      DB.motto = document.getElementById('sMotto').value.trim();
      DB.term = DB.term || {};
      DB.term.name = document.getElementById('sTerm').value.trim();
      DB.term.week1Monday = document.getElementById('sW1').value;
      DB.term.totalWeeks = +document.getElementById('sTotal').value || 17;
      saveDB(); toast('已保存'); rerender();
    } else if (act === 'saveHabits') {
      DB.habits = document.getElementById('sHabits').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      saveDB(); toast('已保存'); rerender();
    } else if (act === 'savePeriods') {
      DB.periods = document.getElementById('sPeriods').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      saveDB(); toast('已保存'); rerender();
    } else if (act === 'applyJson') {
      try {
        var obj = JSON.parse(document.getElementById('jsonBox').value);
        applyData(obj, '已应用');
      } catch (err) { toast('JSON 格式有问题，没改动'); }
    } else if (act === 'fetchCloud') {
      var btnCloud = el;
      btnCloud.textContent = '取回中…';
      fetch(CLOUD_DATA + '?t=' + Date.now())
        .then(function (r) { if (!r.ok) throw new Error('404'); return r.json(); })
        .then(function (obj) { applyData(obj, '数据已取回'); })
        .catch(function () { btnCloud.textContent = '从云端取回我的数据'; toast('没取到（可能已删掉），用下面的粘贴导入'); });
    } else if (act === 'applyPaste') {
      var box = document.getElementById('pasteBox');
      parsePayload(box.value).then(function (obj) {
        if (!obj) { toast('没看懂这段内容'); return; }
        box.value = ''; applyData(obj, '数据已导入');
      });
    } else if (act === 'copyLink') {
      var btn = el;
      btn.textContent = '生成中…';
      makeLink().then(function (url) {
        btn.textContent = '复制导入链接';
        copyText(url, '链接已复制（' + url.length + ' 字），发到微信就能在手机上打开');
      });
    } else if (act === 'download') {
      var blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'workbench-data.json';
      document.body.appendChild(a); a.click(); a.remove();
    } else if (act === 'reset') {
      if (confirm('清空这台手机上的数据，恢复示例？')) {
        DB = clone(DEMO); saveDB(DB);
        try { localStorage.removeItem(LS_DAILY); } catch (e3) { }
        toast('已恢复示例'); rerender();
      }
    } else if (act === 'forceUpdate') {
      toast('正在更新…');
      var jobs = [];
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(rs.map(function (r) { return r.unregister(); }));
          }));
        }
      } catch (e4) { }
      try {
        if (window.caches && caches.keys) {
          jobs.push(caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          }));
        }
      } catch (e5) { }
      Promise.all(jobs).catch(function () { }).then(function () {
        setTimeout(function () { location.replace(location.pathname + '?u=' + Date.now()); }, 400);
      });
    }
  });

  function copyText(text, okMsg) {
    if (!text) { toast('还没有内容'); return; }
    var done = function () { toast(okMsg || '已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选中'); }
    ta.remove();
  }

  /* 复盘：输入时自动存草稿 */
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'review') {
      var key = ymd(new Date());
      var D = loadDaily(), d = today(key);
      d.review = e.target.value; D[key] = d; saveDaily(D);
    }
  });
  /* 回车快速添加 */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var map = { newTask: 'addTask', ddlTitle: 'ddlAdd', cdTitle: 'cdAdd' };
    var a = map[e.target.id];
    if (a) { e.preventDefault(); var b = document.querySelector('[data-act="' + a + '"]'); if (b) b.click(); }
  });

  render();
  (async function () {
    var imported = await readHash();
    if (!imported) return;
    DB = imported; saveDB(DB); markSeen(); clearHash();
    seenWeek = 'cur'; render();
    toast('数据已导入这台手机');
  })();
  /* 不再使用 service worker（它正是"卡在旧版本"的元凶）。
     这里主动清理以前版本留下的 SW 和缓存，最多自动刷新一次。 */
  if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      if (!rs.length) return;
      return Promise.all(rs.map(function (r) { return r.unregister(); })).then(function () {
        if (window.caches && caches.keys) {
          return caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          });
        }
      }).then(function () {
        try {
          if (!sessionStorage.getItem('wb.cleaned')) {
            sessionStorage.setItem('wb.cleaned', '1');
            location.reload();
          }
        } catch (e) { }
      });
    }).catch(function () { });
  }
})();
