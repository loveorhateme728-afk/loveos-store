/* ============================================================
   LOVEOS BANK v2 — shared economy for all LoveOrHateMe728 games
   CEO TroyFeeney · © 2026 LOVE OS Inc.

   Engine: Troy's BankSystem class (pasted 2026-10-29), verbatim
   in spirit and numbers, with two coherence fixes that are
   FLAGGED in place (search "FIX:"):
   1. applyInterest no longer forces bank = -loan (that line
      would erase a positive cash balance down to -loan).
      Interest grows the loan only.
   2. removeMoney's negative sync keeps the larger debt
      (loan = max(loan, |bank|)) instead of overwriting an
      existing loan balance with the smaller |bank|.

   THE RULES:
   - Bank starts at 0 · Job pays $15/hr, taxed 15% at payroll
   - Bills = rent $200 + food $150, every game-month (10 min)
   - Shop: buy only if the money can move (Bank >= price,
     or an active loan covers it down to the -$1,000 floor)
   - Loans: take up to $1,000 · 10% interest per month ·
     bank floor is -$1,000 (maxDebt)
   - Transaction ledger: last 100, newest first on statement
   - Save key 'bankSave' · autosave every 30 seconds
   In-game dollars only — no real money moves here.
   ============================================================ */
(function () {
  "use strict";

  var CONFIG = {
    MONTH_SECONDS: 600,        // one game-month = 10 real minutes
    AUTOSAVE_SECONDS: 30,      // CEO spec: save every 30 sec
    SAVE_KEY: "bankSave",      // Troy's key
    LEGACY_KEY: "loveos_bank_v1"
  };

  var DEFAULT_SHOP = [
    { id: "coffee", name: "Energy Coffee", price: 5 },
    { id: "paint", name: "Neon Paint Job", price: 25 },
    { id: "vip", name: "VIP Pass", price: 100 },
    { id: "crown", name: "CEO Crown (cosmetic)", price: 500 }
  ];

  /* ============ Troy's BankSystem (class -> ES5 ctor) ============ */
  function BankSystem(savedData) {
    var saved = savedData || {};
    this.bank = saved.bank || 0;
    this.loan = saved.loan || 0;
    this.transactions = saved.transactions || [];

    this.hourlyRate = 15;
    this.hasLoan = this.loan > 0;
    this.maxDebt = -1000;
    this.interestRate = 0.10; // 10% interest
    this.saveInterval = null;

    // Panel extras (kept alongside his three saved fields)
    this.hoursWorked = saved.hoursWorked || 0;
    this.monthLeft = (typeof saved.monthLeft === "number" && saved.monthLeft > 0) ? saved.monthLeft : CONFIG.MONTH_SECONDS;
    this.owned = Array.isArray(saved.owned) ? saved.owned : [];
    this.unpaid = saved.unpaid || 0;
  }

  BankSystem.prototype.log = function (type, amount, note) {
    this.transactions.push({
      type: type, // work, bill, buy, loan, repay, interest
      amount: amount,
      bankAfter: this.bank,
      loanAfter: this.loan,
      note: note || "",
      time: new Date().toISOString()
    });
    // keep last 100 only to save space
    if (this.transactions.length > 100) this.transactions.shift();
  };

  BankSystem.prototype.work = function (hours) {
    if (hours <= 0) return false;
    var gross = this.hourlyRate * hours;
    var taxes = gross * 0.15;
    var net = gross - taxes;
    this.bank += net;
    this.hoursWorked += hours;
    this.log("work", net, hours + "h worked, tax $" + taxes.toFixed(2));
    return { net: net, bank: this.bank };
  };

  BankSystem.prototype.payBills = function (foodCost) {
    if (foodCost === undefined) foodCost = 150;
    var total = 200 + foodCost; // $200 rent + food
    if (this.removeMoney(total)) {
      this.log("bill", -total, "Rent $200 + Food $" + foodCost);
      return true;
    }
    return false;
  };

  BankSystem.prototype.buy = function (price, itemName) {
    if (this.removeMoney(price)) {
      this.log("buy", -price, itemName || "item");
      return true;
    }
    return false;
  };

  BankSystem.prototype.removeMoney = function (amount) {
    if (amount <= 0) return false;
    if (!this.hasLoan && this.bank < amount) return false;
    if (this.bank - amount < this.maxDebt) return false;

    this.bank -= amount;
    if (this.bank < 0) {
      this.hasLoan = true;
      // FIX: was loan = |bank|, which erased an existing larger
      // loan balance. Debt never shrinks by spending.
      this.loan = Math.max(this.loan, Math.abs(this.bank));
    }
    return true;
  };

  BankSystem.prototype.takeLoan = function (amount) {
    if (amount <= 0 || amount > 1000) return false;
    this.hasLoan = true;
    this.bank += amount;
    this.loan += amount;
    this.log("loan", amount, "Took loan");
    return true;
  };

  BankSystem.prototype.repayLoan = function (amount) {
    if (!this.hasLoan || this.bank < amount) return false;
    this.bank -= amount;
    this.loan -= amount;
    if (this.loan <= 0) {
      this.loan = 0;
      this.hasLoan = false;
    }
    this.log("repay", -amount, "Loan repaid");
    return true;
  };

  // Call this monthly (runs with the bills cycle)
  BankSystem.prototype.applyInterest = function () {
    if (!this.hasLoan || this.loan <= 0) return;
    var interest = this.loan * this.interestRate;
    this.loan += interest;
    // FIX: his paste had `this.bank = -this.loan; // sync bank debt`
    // here — with cash in hand (e.g. bank 302, loan 200) that line
    // would wipe the cash to -220. Interest grows the LOAN only.
    this.log("interest", -interest, (this.interestRate * 100) + "% interest");
  };

  BankSystem.prototype.getStatement = function () {
    return this.transactions.slice().reverse();
  };

  BankSystem.prototype.save = function () {
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify({
        bank: this.bank,
        loan: this.loan,
        transactions: this.transactions,
        hoursWorked: this.hoursWorked,
        monthLeft: this.monthLeft,
        owned: this.owned,
        unpaid: this.unpaid
      }));
    } catch (e) {}
  };

  BankSystem.prototype.startAutoSave = function () {
    var self = this;
    this.saveInterval = setInterval(function () { self.save(); flashSaved(); }, CONFIG.AUTOSAVE_SECONDS * 1000);
  };

  /* ============ Load (with one-time migration from v1) ============ */
  function loadSaved() {
    try {
      var raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (raw) return JSON.parse(raw);
      var legacy = localStorage.getItem(CONFIG.LEGACY_KEY);
      if (legacy) {
        var d = JSON.parse(legacy);
        return { bank: d.bank || 0, loan: 0, transactions: [],
                 hoursWorked: d.hoursWorked || 0, monthLeft: d.monthLeft,
                 owned: d.owned || [], unpaid: d.unpaid || 0 };
      }
    } catch (e) {}
    return {};
  }

  var player = new BankSystem(loadSaved());

  /* ============ Panel UI ============ */
  var shopItems = DEFAULT_SHOP.slice();
  var el = {};
  function fmt(n) { var v = Math.round(n * 100) / 100; return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function mmss(s) { var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }

  function buildUI() {
    var css = document.createElement("style");
    css.textContent =
      "#lob{position:fixed;right:10px;bottom:10px;z-index:99990;width:258px;background:rgba(7,14,22,.94);border:1px solid #00e5ff;border-radius:12px;color:#d7ecf5;font:13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 6px 30px rgba(0,229,255,.25);overflow:hidden}" +
      "#lob header{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;cursor:pointer;background:rgba(0,229,255,.08)}" +
      "#lob header b{color:#00e5ff;letter-spacing:.06em}" +
      "#lobBal{color:#00ff9d;font-weight:800}#lobBal.neg{color:#ff8fa3}" +
      "#lobBody{padding:9px 10px;max-height:70vh;overflow-y:auto}" +
      "#lobBody .row{display:flex;justify-content:space-between;margin:2px 0}" +
      "#lobBody .dim{opacity:.75}" +
      "#lob button{background:#0a2a1a;color:#00ff9d;border:1px solid #00ff9d;border-radius:7px;padding:6px 8px;cursor:pointer;font-weight:700;font-size:12px}" +
      "#lob button:hover{background:#0f3d26}" +
      "#lob .btnrow{display:flex;gap:6px;margin:8px 0}" +
      "#lob .btnrow button{flex:1}" +
      "#lob .loanrow button{background:#2a1a0a;color:#ffd700;border-color:#ffd700}" +
      "#lobShop,#lobStmt{border-top:1px solid #14303f;margin-top:8px;padding-top:8px}" +
      "#lobShop .item{display:flex;justify-content:space-between;align-items:center;margin:4px 0}" +
      "#lobShop .item button{padding:3px 8px}" +
      "#lobShop .owned{color:#ffd700;font-size:11px;font-weight:700}" +
      "#lobStmt .tx{display:flex;justify-content:space-between;gap:6px;font-size:11px;margin:3px 0;opacity:.9}" +
      "#lobStmt .tx .amt{text-align:right;white-space:nowrap}" +
      "#lobStmt .pos{color:#00ff9d}#lobStmt .negc{color:#ff8fa3}" +
      "#lobWarn{color:#ff8fa3;font-weight:700}" +
      "#lobFoot{font-size:10px;opacity:.6;margin-top:8px;line-height:1.5}" +
      "#lobToast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99991;background:rgba(7,14,22,.95);border:1px solid #00ff9d;color:#d7ecf5;border-radius:999px;padding:8px 16px;font:13px system-ui,sans-serif;opacity:0;transition:opacity .25s;pointer-events:none;max-width:92vw;text-align:center}" +
      "#lobSaved{color:#00ff9d;font-size:10px;opacity:0;transition:opacity .3s}";
    document.head.appendChild(css);

    var box = document.createElement("div");
    box.id = "lob";
    box.innerHTML =
      "<header id='lobHead'><b>🏦 LOVEOS BANK</b><span id='lobBal'>$0</span></header>" +
      "<div id='lobBody'>" +
        "<div class='row'><span class='dim'>Hours worked</span><span id='lobHours'>0h</span></div>" +
        "<div class='row'><span class='dim'>Loan</span><span id='lobLoan'>none</span></div>" +
        "<div class='row'><span class='dim'>Bills due in</span><span id='lobTimer'>10:00</span></div>" +
        "<div class='row'><span class='dim'>Next bills</span><span>$350 (rent $200 + food $150)</span></div>" +
        "<div class='row' id='lobWarnRow' style='display:none'><span>Bills missed</span><span id='lobWarn'>$0</span></div>" +
        "<div class='btnrow'><button id='lobW1' type='button'>Work 1h · +$12.75</button><button id='lobW8' type='button'>Shift 8h · +$102</button></div>" +
        "<div class='btnrow loanrow'><button id='lobLoanBtn' type='button'>Take loan $100</button><button id='lobRepayBtn' type='button'>Repay $100</button></div>" +
        "<div id='lobShop'><b style='color:#7df9ff'>SHOP</b><div id='lobItems'></div></div>" +
        "<div id='lobStmt'><b style='color:#7df9ff'>STATEMENT</b><div id='lobTx'></div></div>" +
        "<div id='lobFoot'>In-game dollars · $15/hr − 15% tax · bills $350/mo · loans to −$1,000 at 10%/mo interest · <span id='lobSaved'>Saved ✓</span><br>Autosaves every 30s · © 2026 LOVE OS Inc.</div>" +
      "</div>";
    document.body.appendChild(box);

    var toastEl = document.createElement("div");
    toastEl.id = "lobToast";
    document.body.appendChild(toastEl);

    el.bal = document.getElementById("lobBal");
    el.hours = document.getElementById("lobHours");
    el.loan = document.getElementById("lobLoan");
    el.timer = document.getElementById("lobTimer");
    el.warnRow = document.getElementById("lobWarnRow");
    el.warn = document.getElementById("lobWarn");
    el.items = document.getElementById("lobItems");
    el.tx = document.getElementById("lobTx");
    el.toast = toastEl;
    el.saved = document.getElementById("lobSaved");
    el.body = document.getElementById("lobBody");

    document.getElementById("lobW1").addEventListener("click", function () { doWork(1); });
    document.getElementById("lobW8").addEventListener("click", function () { doWork(8); });
    document.getElementById("lobLoanBtn").addEventListener("click", function () {
      if (player.takeLoan(100)) { toast("Loan +$100 — you owe " + fmt(player.loan) + " (10%/mo interest)"); }
      else toast("Loan refused — max single loan is $1,000");
      render(); player.save();
    });
    document.getElementById("lobRepayBtn").addEventListener("click", function () {
      var amt = Math.min(100, player.loan, player.bank);
      if (amt > 0 && player.repayLoan(amt)) toast("Repaid " + fmt(amt) + " — loan left: " + fmt(player.loan));
      else toast(player.hasLoan ? "Can't repay right now — bank must cover the payment" : "No loan to repay");
      render(); player.save();
    });
    document.getElementById("lobHead").addEventListener("click", function () {
      el.body.style.display = (el.body.style.display === "none") ? "" : "none";
    });
  }

  function doWork(hours) {
    var r = player.work(hours);
    if (r) toast("Worked " + hours + "h — net " + fmt(r.net) + " after 15% tax");
    render(); player.save();
  }

  function doBuy(item) {
    if (player.owned.indexOf(item.id) !== -1) { toast(item.name + " — already owned"); return; }
    if (player.buy(item.price, item.name)) {
      player.owned.push(item.id);
      toast("Bought " + item.name + " — " + fmt(item.price));
    } else {
      toast("Can't buy " + item.name + " — bank can't cover it. Work, or take a loan.");
    }
    render(); player.save();
  }

  function renderShop() {
    el.items.innerHTML = "";
    shopItems.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "item";
      row.innerHTML = "<span>" + item.name + " · " + fmt(item.price) + "</span>";
      if (player.owned.indexOf(item.id) !== -1) {
        var tag = document.createElement("span");
        tag.className = "owned"; tag.textContent = "OWNED";
        row.appendChild(tag);
      } else {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = "Buy";
        b.addEventListener("click", function () { doBuy(item); });
        row.appendChild(b);
      }
      el.items.appendChild(row);
    });
  }

  function renderStmt() {
    var txs = player.getStatement().slice(0, 6);
    if (!txs.length) { el.tx.innerHTML = "<div class='tx'><span class='dim'>No transactions yet — work a shift.</span></div>"; return; }
    el.tx.innerHTML = "";
    txs.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "tx";
      var when = "";
      try { var d = new Date(t.time); when = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); } catch (e) {}
      var left = document.createElement("span");
      left.textContent = when + " " + t.type + (t.note ? " · " + t.note : "");
      var right = document.createElement("span");
      right.className = "amt " + (t.amount >= 0 ? "pos" : "negc");
      right.textContent = (t.amount >= 0 ? "+" : "−") + fmt(Math.abs(t.amount)).slice(0);
      row.appendChild(left); row.appendChild(right);
      el.tx.appendChild(row);
    });
  }

  function render() {
    if (!el.bal) return;
    el.bal.textContent = fmt(player.bank);
    el.bal.className = player.bank < 0 ? "neg" : "";
    el.bal.id = "lobBal";
    el.hours.textContent = player.hoursWorked + "h";
    el.loan.textContent = player.hasLoan ? fmt(player.loan) + " owed" : "none";
    el.timer.textContent = mmss(player.monthLeft);
    el.warnRow.style.display = player.unpaid > 0 ? "" : "none";
    el.warn.textContent = fmt(player.unpaid);
    renderShop(); renderStmt();
  }

  var toastTimer = null;
  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.opacity = "1";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.opacity = "0"; }, 3400);
  }

  function flashSaved() {
    if (!el.saved) return;
    el.saved.style.opacity = "1";
    setTimeout(function () { el.saved.style.opacity = "0"; }, 1200);
  }

  /* ---- Monthly cycle: interest, then bills ---- */
  function tick() {
    player.monthLeft -= 1;
    if (player.monthLeft <= 0) {
      player.monthLeft = CONFIG.MONTH_SECONDS;
      player.applyInterest();
      if (player.payBills()) {
        toast("Bills paid: $350 (rent $200 + food $150)" + (player.hasLoan ? " · loan now " + fmt(player.loan) : ""));
      } else {
        player.unpaid += 350;
        toast("Bills $350 DUE — bank can't cover them. Work some hours!");
      }
      render(); player.save();
    } else if (el.timer) {
      el.timer.textContent = mmss(player.monthLeft);
    }
  }

  function init() {
    buildUI();
    render();
    player.startAutoSave();
    setInterval(tick, 1000);
    window.addEventListener("pagehide", function () { player.save(); });
  }

  /* Public handles for host games */
  window.BankSystem = BankSystem;
  window.LoveOSBank = player;
  window.LoveOSBankShop = function (items) { if (Array.isArray(items) && items.length) { shopItems = items.slice(); renderShop(); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
