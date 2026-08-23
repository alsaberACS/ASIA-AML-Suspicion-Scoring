// src/tools/user-manual/manual.tsx
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Svg,
  Path,
  Font,
  renderToBuffer
} from "@react-pdf/renderer";
import { jsx, jsxs } from "react/jsx-runtime";
var HERE = path.dirname(fileURLToPath(import.meta.url));
var ARTIFACT_DIR = path.resolve(HERE, HERE.includes("dist-tools") ? ".." : "../../..");
var ROOT = path.resolve(ARTIFACT_DIR, "../..");
var SHOTS = path.join(ROOT, "screenshots/manual");
var CROPS = path.join(SHOTS, "crops");
var BRAND = path.join(ROOT, "artifacts/aml-console/public/brand");
var ABOUT_IMG = path.join(ROOT, "artifacts/aml-console/public/about");
var FONTS = path.join(ARTIFACT_DIR, "assets/fonts");
var OUT = path.join(ROOT, "documents/ASIA-AML-Console-User-Manual.pdf");
var must = (p) => {
  if (!fs.existsSync(p)) throw new Error(`missing asset: ${p}`);
  return p;
};
Font.register({ family: "Hand", src: must(path.join(FONTS, "PatrickHand-Regular.ttf")) });
Font.registerHyphenationCallback((w) => [w]);
var INK = "#1A2433";
var MUTED = "#5B6B7C";
var FAINT = "#93A1B0";
var LINE = "#DFE4EA";
var CREAM = "#EFEAE2";
var BAND_BG = "#F5F3EE";
var STAND = "#4A7FA5";
var ACCENT = "#0F766E";
var RED = "#B91C1C";
var NOTE_BLUE = "#3D6B94";
var NOTE_WARM = "#B45309";
var DK_BG = "#0D1524";
var DK_TEXT = "#F4F7FB";
var DK_SLATE = "#9FB0C3";
var DK_CYAN = "#4CC3F0";
var DK_RULE = "#2A3A52";
var MARGIN = 48;
var CW = 595.28 - MARGIN * 2;
var Footer = () => /* @__PURE__ */ jsxs(
  View,
  {
    fixed: true,
    style: {
      position: "absolute",
      left: MARGIN,
      right: MARGIN,
      bottom: 18,
      height: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end"
    },
    children: [
      /* @__PURE__ */ jsxs(Text, { style: { fontSize: 7.2, color: MUTED }, children: [
        /* @__PURE__ */ jsx(Text, { style: { color: INK, fontFamily: "Helvetica-Bold" }, children: "Suspicion Scoring Console: " }),
        "Analyst User Manual"
      ] }),
      /* @__PURE__ */ jsx(
        Text,
        {
          style: { fontSize: 7.2, color: INK, fontFamily: "Helvetica-Bold", marginLeft: 10 },
          render: ({ pageNumber }) => String(pageNumber)
        }
      )
    ]
  }
);
var P = ({ children, style }) => /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.8, lineHeight: 1.55, color: INK, marginBottom: 7, ...style }, children });
var SectionHead = ({ n, title, stand }) => /* @__PURE__ */ jsxs(View, { style: { marginBottom: 12 }, children: [
  /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 8 }, children: [
    /* @__PURE__ */ jsx(View, { style: { width: 21, height: 21, backgroundColor: INK, alignItems: "center", justifyContent: "center", marginRight: 8 }, children: /* @__PURE__ */ jsx(Text, { style: { color: "#FFFFFF", fontSize: 11, fontFamily: "Helvetica-Bold" }, children: n }) }),
    /* @__PURE__ */ jsx(Text, { style: { fontSize: 16.5, fontFamily: "Helvetica-Bold", color: INK }, children: title })
  ] }),
  /* @__PURE__ */ jsx(View, { style: { marginLeft: 29, borderLeftWidth: 2, borderLeftColor: STAND, paddingLeft: 9 }, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 9.6, lineHeight: 1.5, color: STAND }, children: stand }) })
] });
var Box = ({ title, children, color = ACCENT }) => /* @__PURE__ */ jsxs(View, { style: { backgroundColor: BAND_BG, borderLeftWidth: 3, borderLeftColor: color, padding: 10, marginTop: 4, marginBottom: 6 }, children: [
  /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.4, letterSpacing: 1.6, color, fontFamily: "Helvetica-Bold", marginBottom: 5 }, children: title }),
  children
] });
var Step = ({ n, children }) => /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", marginBottom: 4.5 }, children: [
  /* @__PURE__ */ jsx(Text, { style: { width: 16, fontSize: 8.6, fontFamily: "Helvetica-Bold", color: ACCENT }, children: n }),
  /* @__PURE__ */ jsx(Text, { style: { flex: 1, fontSize: 8.6, lineHeight: 1.45, color: INK }, children })
] });
var wob = (x1, y1, x2, y2, bend) => {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const cx = mx + nx * len * bend, cy = my + ny * len * bend;
  return { d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, cx, cy };
};
var Fig = ({ no, title, src, srcW, srcH, imgW, notes = [], boxH }) => {
  const railed = imgW === void 0;
  const W = imgW ?? 383;
  const imgH = srcH / srcW * W;
  const innerW = CW - 20;
  const noteBottom = notes.reduce((m, n) => {
    const noteW = n.nw ?? (railed ? innerW - W - 12 : 110);
    const lines = Math.max(1, Math.ceil(n.t.length * 5 / noteW));
    return Math.max(m, n.ny + lines * 11.8 + 8);
  }, 0);
  const H = Math.max(boxH ?? 0, imgH, noteBottom);
  const arrows = notes.map((n) => {
    const noteW = n.nw ?? (railed ? innerW - W - 12 : 110);
    let ax = n.nx, ay = n.ny + 6;
    if ((n.from ?? "left") === "left") {
      ax = n.nx - 3;
      ay = n.ny + 7;
    }
    if (n.from === "right") {
      ax = n.nx + noteW + 3;
      ay = n.ny + 7;
    }
    if (n.from === "top") {
      ax = n.nx + noteW / 2;
      ay = n.ny - 3;
    }
    if (n.from === "bottom") {
      ax = n.nx + noteW / 2;
      ay = n.ny + 16;
    }
    const tx = n.fx * W, ty = n.fy * imgH;
    const { d, cx, cy } = wob(ax, ay, tx, ty, n.bend ?? 0.22);
    const ang = Math.atan2(ty - cy, tx - cx);
    const hl = 5.5;
    const h1 = { x: tx + Math.cos(ang + 2.65) * hl, y: ty + Math.sin(ang + 2.65) * hl };
    const h2 = { x: tx + Math.cos(ang - 2.65) * hl, y: ty + Math.sin(ang - 2.65) * hl };
    return { d, h1, h2, tx, ty, color: n.color ?? NOTE_BLUE };
  });
  return /* @__PURE__ */ jsxs(View, { wrap: false, style: { backgroundColor: BAND_BG, padding: 10, marginTop: 6, marginBottom: 8 }, children: [
    /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", alignItems: "flex-start", marginBottom: 7 }, children: [
      /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.6, letterSpacing: 1.8, color: STAND, fontFamily: "Helvetica-Bold", marginTop: 1 }, children: `FIGURE ${no}` }),
      /* @__PURE__ */ jsx(View, { style: { width: 1, backgroundColor: FAINT, alignSelf: "stretch", marginHorizontal: 8 } }),
      /* @__PURE__ */ jsx(Text, { style: { flex: 1, fontSize: 8.8, fontFamily: "Helvetica-Bold", color: INK, lineHeight: 1.35 }, children: title })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: { position: "relative", width: innerW, height: H }, children: [
      /* @__PURE__ */ jsx(Image, { src, style: { position: "absolute", left: 0, top: 0, width: W, height: imgH, borderWidth: 0.75, borderColor: LINE } }),
      notes.map((n, i) => /* @__PURE__ */ jsx(
        Text,
        {
          style: {
            position: "absolute",
            left: n.nx,
            top: n.ny,
            width: n.nw ?? (railed ? innerW - W - 12 : 110),
            fontFamily: "Hand",
            fontSize: 10.5,
            lineHeight: 1.12,
            color: n.color ?? NOTE_BLUE,
            transform: `rotate(${n.rot ?? "-2deg"})`
          },
          children: n.t
        },
        i
      )),
      /* @__PURE__ */ jsx(Svg, { style: { position: "absolute", left: 0, top: 0 }, width: innerW, height: H, children: arrows.map((a, i) => /* @__PURE__ */ jsxs(React.Fragment, { children: [
        /* @__PURE__ */ jsx(Path, { d: a.d, stroke: a.color, strokeWidth: 1.3, fill: "none", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx(Path, { d: `M ${a.tx.toFixed(1)} ${a.ty.toFixed(1)} L ${a.h1.x.toFixed(1)} ${a.h1.y.toFixed(1)}`, stroke: a.color, strokeWidth: 1.3, strokeLinecap: "round" }),
        /* @__PURE__ */ jsx(Path, { d: `M ${a.tx.toFixed(1)} ${a.ty.toFixed(1)} L ${a.h2.x.toFixed(1)} ${a.h2.y.toFixed(1)}`, stroke: a.color, strokeWidth: 1.3, strokeLinecap: "round" })
      ] }, i)) })
    ] })
  ] });
};
var Body = ({ children }) => /* @__PURE__ */ jsxs(Page, { size: "A4", style: { paddingTop: 40, paddingBottom: 44, paddingHorizontal: MARGIN, fontFamily: "Helvetica", color: INK }, children: [
  children,
  /* @__PURE__ */ jsx(Footer, {})
] });
var A = {
  logoNavy: must(path.join(BRAND, "asia-logo-navy.png")),
  logoWhite: must(path.join(BRAND, "asia-logo-white.png")),
  markCyan: must(path.join(BRAND, "asia-mark-cyan.png")),
  cover: must(path.join(ABOUT_IMG, "holo-dashboard.jpg")),
  landing: must(path.join(SHOTS, "01-landing.jpg")),
  dashboard: must(path.join(SHOTS, "02-dashboard.jpg")),
  cases: must(path.join(SHOTS, "03-cases.jpg")),
  rulesPage: must(path.join(CROPS, "rules-page-top.png")),
  intel: must(path.join(CROPS, "intel-top.png")),
  about: must(path.join(CROPS, "about-top.png")),
  paper: must(path.join(SHOTS, "08-theme-paper.jpg")),
  caseHeader: must(path.join(CROPS, "case-header.png")),
  intake: must(path.join(CROPS, "intake.png")),
  evHeader: must(path.join(CROPS, "evidence-header.png")),
  drivers: must(path.join(CROPS, "drivers.png")),
  dq: must(path.join(CROPS, "dataquality.png")),
  tabRules: must(path.join(CROPS, "tab-rules.png")),
  tabSanctions: must(path.join(CROPS, "tab-sanctions.png")),
  tabAi: must(path.join(CROPS, "tab-ai.png")),
  tabDispo: must(path.join(CROPS, "tab-disposition.png")),
  tabHistory: must(path.join(CROPS, "tab-history.png"))
};
var TOC = [
  { t: "How to read this manual", p: 3 },
  { n: "1", t: "Getting in", p: 4 },
  { n: "2", t: "The Command Center", p: 5 },
  { n: "3", t: "Case Registry: creating and managing cases", p: 6 },
  { n: "4", t: "The case file: profile and data intake", p: 7 },
  { n: "5", t: "The evidence pack: reading the verdict", p: 8 },
  { n: "6", t: "Summary drivers: why the score is what it is", p: 9 },
  { n: "7", t: "Data quality: how much to trust the ledger", p: 10 },
  { n: "8", t: "Rule engine: seventeen typology tests", p: 11 },
  { n: "9", t: "Sanctions screening", p: 12 },
  { n: "10", t: "AI analyst: narrative with receipts", p: 13 },
  { n: "11", t: "Disposition: recording your decision", p: 14 },
  { n: "12", t: "Run history: watching the score over time", p: 15 },
  { n: "13", t: "Six more views in the evidence pack", p: 16 },
  { n: "14", t: "Portfolio analytics: rules and counterparties", p: 17 },
  { n: "15", t: "Personalization and the About page", p: 18 },
  { n: "16", t: "Field notes: tips and troubleshooting", p: 19 },
  { t: "About ASIA Consulting", p: 20 }
];
var Manual = () => /* @__PURE__ */ jsxs(
  Document,
  {
    title: "ASIA AML Suspicion Scoring Console \u2014 Analyst User Manual",
    author: "ASIA Consulting and Private Training \u2014 ASIA Data-Science",
    subject: "User manual and feature guide",
    children: [
      /* @__PURE__ */ jsxs(Page, { size: "A4", style: { backgroundColor: CREAM, fontFamily: "Helvetica" }, children: [
        /* @__PURE__ */ jsxs(View, { style: { paddingTop: 42, paddingHorizontal: 46, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxs(Text, { style: { fontSize: 8.6, lineHeight: 1.4, color: INK, width: 200 }, children: [
            "ASIA Consulting and Private Training",
            "\n",
            "ASIA Data-Science"
          ] }),
          /* @__PURE__ */ jsx(Image, { src: A.logoNavy, style: { width: 92, height: 92 * 0.32, objectFit: "contain" } })
        ] }),
        /* @__PURE__ */ jsxs(View, { style: { paddingHorizontal: 46, marginTop: 46 }, children: [
          /* @__PURE__ */ jsxs(Text, { style: { fontSize: 27.5, lineHeight: 1.18, color: INK, fontFamily: "Helvetica-Bold", letterSpacing: -0.2 }, children: [
            "Suspicion Scoring Console:",
            "\n",
            "A Field Manual for",
            "\n",
            "Financial-Crime Analysts"
          ] }),
          /* @__PURE__ */ jsx(View, { style: { flexDirection: "row", alignItems: "center", marginTop: 24 }, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 10.5, letterSpacing: 3.2, color: INK, fontFamily: "Helvetica-Bold" }, children: "USER MANUAL" }) }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 10.5, letterSpacing: 3.2, color: MUTED, marginTop: 7 }, children: "AUGUST 2026" })
        ] }),
        /* @__PURE__ */ jsxs(View, { style: { position: "absolute", left: 46, top: 388 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { fontFamily: "Hand", fontSize: 15, color: NOTE_BLUE, transform: "rotate(-2deg)" }, children: "everything you need to run a case, end to end" }),
          /* @__PURE__ */ jsxs(Svg, { width: 200, height: 26, children: [
            /* @__PURE__ */ jsx(Path, { d: "M 8 6 Q 100 22 176 12", stroke: NOTE_BLUE, strokeWidth: 1.5, fill: "none", strokeLinecap: "round" }),
            /* @__PURE__ */ jsx(Path, { d: "M 176 12 L 167 8", stroke: NOTE_BLUE, strokeWidth: 1.5, strokeLinecap: "round" }),
            /* @__PURE__ */ jsx(Path, { d: "M 176 12 L 168 18", stroke: NOTE_BLUE, strokeWidth: 1.5, strokeLinecap: "round" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs(View, { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: 396 }, children: [
          /* @__PURE__ */ jsx(View, { style: { height: 2, backgroundColor: INK } }),
          /* @__PURE__ */ jsx(Image, { src: A.cover, style: { width: "100%", height: 394, objectFit: "cover" } })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Page, { size: "A4", style: { paddingTop: 54, paddingBottom: 44, paddingHorizontal: MARGIN, fontFamily: "Helvetica", color: INK }, children: [
        /* @__PURE__ */ jsx(Text, { style: { fontSize: 26, color: INK, marginBottom: 26 }, children: "Contents" }),
        TOC.map((r, i) => /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", alignItems: "flex-start", marginBottom: r.n ? 7.5 : 11, marginTop: r.n ? 0 : i === 0 ? 0 : 3 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { width: 22, fontSize: 9.4, color: STAND, fontFamily: r.n ? "Helvetica" : "Helvetica-Bold" }, children: r.n ?? "" }),
          /* @__PURE__ */ jsx(Text, { style: { flex: 1, fontSize: 9.4, lineHeight: 1.35, color: INK, fontFamily: r.n ? "Helvetica" : "Helvetica-Bold" }, children: r.t }),
          /* @__PURE__ */ jsx(Text, { style: { width: 26, fontSize: 9.4, color: INK, textAlign: "right" }, children: r.p })
        ] }, i)),
        /* @__PURE__ */ jsxs(View, { style: { position: "absolute", left: MARGIN, bottom: 60, width: 190 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.6, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 4 }, children: "Disclaimer" }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.2, lineHeight: 1.45, color: MUTED }, children: "This manual documents the ASIA AML Suspicion Scoring Console as deployed for analyst training and case triage. Screens shown use demonstration data; no real customer information appears in this document. Suspicion scores are decision support, not verdicts - the analyst remains responsible for every disposition." }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.2, lineHeight: 1.45, color: MUTED, marginTop: 6 }, children: "(c) 2026 ASIA Consulting and Private Training. All rights reserved." })
        ] }),
        /* @__PURE__ */ jsx(Footer, {})
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(Text, { style: { fontSize: 16.5, fontFamily: "Helvetica-Bold", marginBottom: 10 }, children: "How to read this manual" }),
        /* @__PURE__ */ jsx(View, { style: { borderLeftWidth: 2, borderLeftColor: STAND, paddingLeft: 9, marginBottom: 12 }, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 9.6, lineHeight: 1.5, color: STAND }, children: "The console reads raw bank statements the way a forensic analyst does, then shows its work. This manual walks every screen in the order you will meet it on a real case." }) }),
        /* @__PURE__ */ jsx(P, { children: "The ASIA Suspicion Scoring Console turns a stack of bank statement exports into one consolidated ledger, tests that ledger against seventeen money-laundering typology rules, screens names against sanctions lists, and produces a single suspicion probability with a full driver breakdown. An AI assistant then drafts the case narrative - and a verification layer checks every citation it makes against the real ledger before you see it." }),
        /* @__PURE__ */ jsx(P, { children: "Sections 1 to 5 cover the working loop: sign in, watch the portfolio, create a case, feed it data, and read the verdict. Sections 6 to 13 open each evidence view in turn. Sections 14 to 16 cover portfolio analytics, personalization, and field advice." }),
        /* @__PURE__ */ jsxs(Box, { title: "THE HANDWRITTEN LAYER", children: [
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK, marginBottom: 8 }, children: "Every screenshot in this manual is a real capture of the console. The soft handwritten notes and curved arrows are ours - they point at the exact control being discussed, like a colleague marking up a printout next to you:" }),
          /* @__PURE__ */ jsxs(View, { style: { position: "relative", height: 46 }, children: [
            /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: 6, top: 4, fontFamily: "Hand", fontSize: 11.5, color: NOTE_BLUE, transform: "rotate(-2deg)" }, children: "blue notes explain what a control does" }),
            /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: 250, top: 24, fontFamily: "Hand", fontSize: 11.5, color: NOTE_WARM, transform: "rotate(-1.5deg)" }, children: "warm notes flag what deserves caution" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs(Box, { title: "BEFORE YOU START", color: STAND, children: [
          /* @__PURE__ */ jsx(Step, { n: "1", children: "You need a modern browser and the console address issued by your administrator." }),
          /* @__PURE__ */ jsx(Step, { n: "2", children: "You need an access code. Codes are issued per team; the console refuses entry without one." }),
          /* @__PURE__ */ jsx(Step, { n: "3", children: "Have your subject's bank statement exports ready as Excel or CSV files - any of the five supported bank dialects, Arabic column labels included." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 1, title: "Getting in", stand: "One gate, one code. The landing page states what the system is and asks for exactly one thing." }),
        /* @__PURE__ */ jsx(P, { children: "The console is a restricted system. The landing page carries the ASIA mark, a short statement of what the engine does, and a single access field. Type the code your administrator issued and press ACCESS. There is no self-registration and no password reset flow by design - access is managed centrally." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 1,
            title: "The access gate. Four capability badges under the headline summarise what the engine will do to every case you open.",
            src: A.landing,
            srcW: 1440,
            srcH: 900,
            notes: [
              { t: "type the access code your admin issued - dots keep it private", nx: 391, ny: 128, fx: 0.725, fy: 0.739, bend: -0.18 },
              { t: "one press and you are in", nx: 391, ny: 196, fx: 0.916, fy: 0.762, bend: -0.3, color: NOTE_WARM, rot: "-1.2deg" },
              { t: "what the engine runs on every case", nx: 391, ny: 60, fx: 0.766, fy: 0.612, bend: -0.25 },
              { t: "gated session - close the tab and the code is asked again", nx: 391, ny: 6, fx: 0.902, fy: 0.048, bend: -0.2, rot: "-1.5deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(Box, { title: "IF THE GATE DOES NOT OPEN", color: RED, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "A rejected code shakes the field and stays on the page. Check for a trailing space, then confirm the code with your administrator. Codes are case-sensitive." }) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 2, title: "The Command Center", stand: "Your portfolio at a glance: volumes ingested, risk distribution, and the freshest analysis runs - each one click from its case." }),
        /* @__PURE__ */ jsx(P, { children: "After the gate you land on the Command Center. The left rail lists the five modules of the console; the header carries global search and, on the right, notifications and the settings menu where appearance themes live." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 2,
            title: "The Command Center. Four KPis summarise the portfolio; the right panel lists recent scoring runs with their bands.",
            src: A.dashboard,
            srcW: 1440,
            srcH: 900,
            notes: [
              { t: "the five modules - this manual walks them top to bottom", nx: 391, ny: 26, fx: 0.088, fy: 0.2, bend: 0.28 },
              { t: "portfolio totals: subjects, files, transactions, gross value", nx: 391, ny: 78, fx: 0.55, fy: 0.273, bend: -0.15 },
              { t: "how many cases sit in each risk band", nx: 391, ny: 130, fx: 0.324, fy: 0.62, bend: 0.2 },
              { t: "newest runs first - Review jumps straight into the case file", nx: 391, ny: 172, fx: 0.923, fy: 0.523, bend: -0.24, color: NOTE_WARM },
              { t: "demo helper: loads a sample case to practice on", nx: 391, ny: 224, fx: 0.914, fy: 0.138, bend: -0.3, rot: "-1.3deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(View, { style: { flexDirection: "row", marginTop: 2 }, children: [
          ["Dashboard", "Portfolio overview and recent runs"],
          ["Case Registry", "Create, open and manage cases"],
          ["Rule Performance", "Which rules fire, portfolio-wide"],
          ["Counterparty Intel", "Parties shared across cases"]
        ].map(([k, v], i) => /* @__PURE__ */ jsxs(View, { style: { flex: 1, borderTopWidth: 1.5, borderTopColor: INK, paddingTop: 5, marginRight: i < 3 ? 10 : 0 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 8, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 2 }, children: k }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.4, lineHeight: 1.4, color: MUTED }, children: v })
        ] }, i)) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 3, title: "Case Registry: creating and managing cases", stand: "One row per subject under investigation. The latest run's band and probability travel with the row." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 3,
            title: "The Case Registry. Each row shows how many banks, files and transactions a case holds, plus its latest scoring result.",
            src: A.cases,
            srcW: 1440,
            srcH: 900,
            notes: [
              { t: "start here - New Case asks only for a name and optional reference", nx: 391, ny: 22, fx: 0.935, fy: 0.138, bend: -0.28, color: NOTE_WARM },
              { t: "band and probability of the newest run", nx: 391, ny: 92, fx: 0.71, fy: 0.322, bend: -0.2 },
              { t: "deletes the case and all of its runs - there is no undo", nx: 391, ny: 140, fx: 0.96, fy: 0.325, bend: -0.26, color: NOTE_WARM, rot: "-1.4deg" },
              { t: "your own file number, if you keep one", nx: 391, ny: 196, fx: 0.4, fy: 0.322, bend: 0.24 }
            ]
          }
        ),
        /* @__PURE__ */ jsxs(Box, { title: "CREATE A CASE IN FOUR STEPS", children: [
          /* @__PURE__ */ jsx(Step, { n: "1", children: "Press New Case, enter the subject's name and an optional internal reference, and save." }),
          /* @__PURE__ */ jsx(Step, { n: "2", children: "Open the case and upload the bank statement exports (Excel or CSV). Drag several files at once - each is parsed on arrival." }),
          /* @__PURE__ */ jsx(Step, { n: "3", children: "Optionally add the subject's financial disclosure PDF through Self Report; the engine extracts declared income and assets from it." }),
          /* @__PURE__ */ jsx(Step, { n: "4", children: "Press Run Analysis. Scoring is deterministic: the same data always produces the same score." })
        ] }),
        /* @__PURE__ */ jsx(P, { style: { marginBottom: 0 }, children: "The parser reads five bank export dialects - compliance exports, core-banking dumps, query extracts, classic statements and signed-amount reports - and understands Arabic column labels. You do not choose the dialect; detection is automatic, file by file." })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 4, title: "The case file: profile and data intake", stand: "Everything the engine knows about the subject, and every file it read - with per-file parsing receipts." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 4,
            title: "Case header. The SCORED chip confirms at least one completed run; Edit Profile holds occupation, declared income and expected countries.",
            src: A.caseHeader,
            srcW: 1440,
            srcH: 470,
            notes: [
              { t: "declared economic profile - the baseline every flow is judged against", nx: 391, ny: 10, fx: 0.32, fy: 0.42, bend: 0.22 },
              { t: "keep working notes here - they stay with the case", nx: 391, ny: 66, fx: 0.53, fy: 0.62, bend: 0.18, rot: "-1.6deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 5,
            title: "Data intake. One card per parsed file: coverage window, masked accounts, rows parsed and an extraction-quality bar.",
            src: A.intake,
            srcW: 1440,
            srcH: 430,
            notes: [
              { t: "quality below 70% makes the engine shrink this file's evidence", nx: 391, ny: 8, fx: 0.39, fy: 0.56, bend: 0.22, color: NOTE_WARM },
              { t: "the receipts: every parsing decision, row by row", nx: 391, ny: 66, fx: 0.265, fy: 0.63, bend: 0.26 }
            ]
          }
        ),
        /* @__PURE__ */ jsxs(Box, { title: "THE THREE INTAKE ACTIONS", children: [
          /* @__PURE__ */ jsx(Step, { n: "1", children: "Upload Files - add more statement exports at any time; re-run the analysis afterwards." }),
          /* @__PURE__ */ jsx(Step, { n: "2", children: "Self Report - attach the subject's signed financial disclosure PDF for declared-versus-observed comparison." }),
          /* @__PURE__ */ jsx(Step, { n: "3", children: "Run Analysis - executes the eight-stage pipeline and stores a new run in the case history." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 5, title: "The evidence pack: reading the verdict", stand: "One number, honestly derived: the suspicion probability, its band, and the exact movement from prior to posterior." }),
        /* @__PURE__ */ jsx(P, { children: "Below the intake section sits the evidence pack - the analytical heart of the case file. The header shows the suspicion probability produced by Bayesian evidence aggregation, the risk band it falls into, and the analysis metadata. Every element below it exists to let you take this number apart." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 6,
            title: "The verdict header. The strip under the gauge shows the movement from the 2.0% base-rate prior to this case's posterior.",
            src: A.evHeader,
            srcW: 1440,
            srcH: 360,
            notes: [
              { t: "starts at the 2% base rate - evidence moves it from there", nx: 391, ny: 8, fx: 0.322, fy: 0.74, bend: 0.24 },
              { t: "quality of the underlying data - low quality pulls scores toward the prior", nx: 391, ny: 58, fx: 0.62, fy: 0.32, bend: -0.18 },
              { t: "the narrative is AI-written, the number never is", nx: 391, ny: 122, fx: 0.918, fy: 0.56, bend: -0.26, color: NOTE_WARM, rot: "-1.3deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(View, { style: { flexDirection: "row", marginTop: 2 }, children: [
          ["LOW", "under 5%"],
          ["MODERATE", "5 - 20%"],
          ["ELEVATED", "20 - 50%"],
          ["HIGH", "50 - 80%"],
          ["CRITICAL", "80% +"]
        ].map(([b, r], i) => /* @__PURE__ */ jsxs(View, { style: { flex: 1, borderTopWidth: 1.5, borderTopColor: i < 2 ? ACCENT : i === 2 ? "#B45309" : RED, paddingTop: 5, marginRight: i < 4 ? 8 : 0 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.8, fontFamily: "Helvetica-Bold", color: INK }, children: b }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 7.4, color: MUTED, marginTop: 1.5 }, children: r })
        ] }, i)) }),
        /* @__PURE__ */ jsx(P, { style: { marginTop: 10, marginBottom: 0 }, children: "Twelve tabs line the bottom of the header - Summary Drivers through History. The next eight sections walk the ones you will use on every case; section 13 summarises the rest. Each tab can be opened directly by adding its name to the case address, for example ?tab=rules." })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 6, title: "Summary drivers: why the score is what it is", stand: "Every contribution to the score, ordered by impact. Green pulls the probability down; red pushes it up." }),
        /* @__PURE__ */ jsx(P, { children: "The drivers list is the fastest way to understand a case. Each row is one piece of evidence with its log-likelihood contribution: the base-rate prior, fired rules, forensic feature signals, and - when data quality is poor - an explicit suppression entry showing how much the engine discounted weak evidence." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 7,
            title: "Bayesian evidence drivers for the demonstration case. The prior appears as its own row, so nothing about the arithmetic is hidden.",
            src: A.drivers,
            srcW: 1440,
            srcH: 520,
            notes: [
              { t: "the honest starting point: most subjects are not launderers", nx: 391, ny: 10, fx: 0.69, fy: 0.21, bend: -0.2 },
              { t: "red bars push suspicion up - the log-LR number is the exact push", nx: 391, ny: 62, fx: 0.6, fy: 0.32, bend: -0.22, color: NOTE_WARM },
              { t: "the engine deducting for shaky data - suppression is itself listed", nx: 391, ny: 122, fx: 0.56, fy: 0.53, bend: -0.2, rot: "-1.5deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(Box, { title: "HOW TO READ IT", color: STAND, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "Read top to bottom: rows are ordered by absolute impact, so the three or four biggest bars usually tell the story. Rules from the same family face diminishing returns - a second hit in one family counts half - so the list cannot be inflated by near-duplicate rules." }) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 7, title: "Data quality: how much to trust the ledger", stand: "Six checks, each with a stamp and its evidence. Quality below 0.70 shrinks evidence toward the prior." }),
        /* @__PURE__ */ jsx(P, { children: "A score is only as good as the statements behind it. The engine grades the consolidated ledger on six checks - parse coverage, running-balance integrity, period overlap, cross-file duplicates, account coverage gaps and more - and prints the outcome of each with the exact files and rows that earned it." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 8,
            title: "The data-quality report for the demonstration case: one WARN, one FAIL, and the receipts for both.",
            src: A.dq,
            srcW: 1440,
            srcH: 445,
            notes: [
              { t: "the combined quality score used by the engine", nx: 391, ny: 8, fx: 0.943, fy: 0.16, bend: -0.28 },
              { t: "FAIL is not cosmetic - balance breaks mean the ledger may be incomplete or altered", nx: 391, ny: 54, fx: 0.941, fy: 0.29, bend: -0.24, color: NOTE_WARM },
              { t: "per-bank detail lines name the file at fault", nx: 391, ny: 126, fx: 0.4, fy: 0.5, bend: 0.22, rot: "-1.4deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(P, { style: { marginBottom: 0 }, children: "The quality score does more than warn. It feeds straight into scoring: below a quality of 0.70 the engine progressively shrinks evidence toward the base rate, and the deduction appears as its own driver row. A clean 46% on solid data and a shaky 46% on broken data are not the same case - this page is how you tell them apart." })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 8, title: "Rule engine: seventeen typology tests", stand: "Each fired rule is a card: what the pattern is, which statement rows triggered it, and the FATF or Egmont source it descends from." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 9,
            title: "Fired rules for the demonstration case. The mono excerpt inside each card quotes the engine's own finding verbatim.",
            src: A.tabRules,
            srcW: 1440,
            srcH: 780,
            notes: [
              { t: "severity chip and rule id - cite these in your memo", nx: 391, ny: 12, fx: 0.233, fy: 0.065, bend: 0.25 },
              { t: "the exact log-odds this rule adds", nx: 391, ny: 66, fx: 0.56, fy: 0.06, bend: -0.2, color: NOTE_WARM },
              { t: "the trigger, quoted from the ledger itself", nx: 391, ny: 112, fx: 0.35, fy: 0.25, bend: 0.2 },
              { t: "the international guidance the rule descends from", nx: 391, ny: 160, fx: 0.35, fy: 0.34, bend: 0.22, rot: "-1.4deg" },
              { t: "jumps to the Transactions view, pre-filtered to the rows behind this rule", nx: 391, ny: 214, fx: 0.52, fy: 0.43, bend: 0.2 }
            ]
          }
        ),
        /* @__PURE__ */ jsx(Box, { title: "WORTH KNOWING", color: STAND, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "Seventeen deterministic rules cover structuring, funnel accounts, dormancy reactivation, velocity bursts, virtual-asset exposure and more. Rules never overlap-count: family diminishing returns halve a second hit from the same family. A rule that did not fire is absent - the engine does not pad the list." }) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 9, title: "Sanctions screening", stand: "Subject and counterparties against OFAC SDN and the UN Consolidated List - with list freshness printed, not presumed." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 10,
            title: "The sanctions view: list freshness at top, the exposure banner, then per-name match cards with alias and identifier detail.",
            src: A.tabSanctions,
            srcW: 1440,
            srcH: 930,
            notes: [
              { t: "both lists auto-refresh every six hours - or force it here", nx: 391, ny: 10, fx: 0.893, fy: 0.055, bend: -0.26 },
              { t: "EXACT means identical canonical name. POSSIBLE means shared name parts - read the card before reacting", nx: 391, ny: 58, fx: 0.32, fy: 0.26, bend: 0.22, color: NOTE_WARM },
              { t: "the subject himself: no match on either list", nx: 391, ny: 140, fx: 0.3, fy: 0.53, bend: 0.24 },
              { t: "matched via a listed alias - check DOB and documents next", nx: 391, ny: 190, fx: 0.42, fy: 0.73, bend: 0.2, rot: "-1.5deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(Box, { title: "CAUTION", color: RED, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "Name similarity is evidence, not identification. Verify identifiers - date of birth, nationality, documents - before acting on any match. Sanctions matches never alter the suspicion score; they are surfaced for your judgment, not added to the arithmetic." }) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 10, title: "AI analyst: narrative with receipts", stand: "An assistant drafts the case story - and a verification layer checks every citation it makes against the real ledger." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 11,
            title: "The AI analyst view. The green strip confirms all 197 citations were verified against case records before display.",
            src: A.tabAi,
            srcW: 1440,
            srcH: 840,
            notes: [
              { t: "every [txn] reference checked against the ledger - broken citations are flagged, not hidden", nx: 391, ny: 8, fx: 0.35, fy: 0.05, bend: 0.2 },
              { t: "declared profile versus observed behaviour, argued point by point", nx: 391, ny: 78, fx: 0.927, fy: 0.17, bend: -0.24 },
              { t: "each typology gets a strength verdict", nx: 391, ny: 140, fx: 0.822, fy: 0.48, bend: -0.2 },
              { t: "the assistant argues both sides - benign readings are listed too", nx: 391, ny: 186, fx: 0.32, fy: 0.69, bend: 0.22, color: NOTE_WARM, rot: "-1.4deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsxs(Box, { title: "WHAT THE AI DOES AND NEVER DOES", children: [
          /* @__PURE__ */ jsx(Step, { n: "+", children: "Drafts the narrative, tests KYC consistency, synthesises typologies, and proposes hypotheses for your review." }),
          /* @__PURE__ */ jsx(Step, { n: "-", children: "Never produces or adjusts the suspicion score. The number exists before the AI runs; deleting the narrative would not change it." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 11, title: "Disposition: recording your decision", stand: "Three outcomes, an auto-drafted memo, and a hypothesis-by-hypothesis review - the decision stays human." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 12,
            title: "The disposition view. The memo draft is pre-filled from the evidence pack; hypothesis rows record your read of each AI suggestion.",
            src: A.tabDispo,
            srcW: 1440,
            srcH: 1020,
            notes: [
              { t: "a filing-ready memo skeleton, drafted from the case evidence", nx: 391, ny: 14, fx: 0.42, fy: 0.24, bend: 0.2 },
              { t: "the three dispositions - your call, recorded with your rationale", nx: 391, ny: 78, fx: 0.55, fy: 0.42, bend: -0.18, color: NOTE_WARM },
              { t: "accept or dismiss each AI hypothesis - unset rows record as undetermined", nx: 391, ny: 138, fx: 0.85, fy: 0.53, bend: -0.22, rot: "-1.3deg" },
              { t: "write why - the rationale is stored with the run", nx: 391, ny: 204, fx: 0.42, fy: 0.76, bend: 0.2 }
            ]
          }
        ),
        /* @__PURE__ */ jsx(P, { style: { marginBottom: 0 }, children: "Decisions feed the Rule Performance module: once cases carry dispositions, that view shows which rules concentrate true escalations and which fire mostly on cases that get closed - the evidence base for tuning rule weights over time." })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 12, title: "Run history: watching the score over time", stand: "Every scoring run for the case, on one line. Newer data should move the score for explainable reasons - unexplained drift is itself a finding." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 13,
            title: "Run history for the demonstration case: nineteen runs, one visible score step when new data arrived.",
            src: A.tabHistory,
            srcW: 1440,
            srcH: 1020,
            notes: [
              { t: "the score trend across runs - steps should have explanations", nx: 391, ny: 12, fx: 0.5, fy: 0.15, bend: -0.18 },
              { t: "the run currently shown everywhere else in the case file", nx: 391, ny: 74, fx: 0.28, fy: 0.29, bend: 0.22 },
              { t: "quality and rule count per run - a quality drop explains a score drop", nx: 391, ny: 132, fx: 0.75, fy: 0.31, bend: -0.2, color: NOTE_WARM, rot: "-1.4deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsxs(Box, { title: "WHEN TO RE-RUN", color: STAND, children: [
          /* @__PURE__ */ jsx(Step, { n: "1", children: "After uploading new statement files or a self-report PDF." }),
          /* @__PURE__ */ jsx(Step, { n: "2", children: "After editing the subject profile - declared income changes the baseline for several rules." }),
          /* @__PURE__ */ jsx(Step, { n: "3", children: "Periodically on open cases: sanctions lists refresh every six hours, and engine updates are versioned into new runs." })
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 13, title: "Six more views in the evidence pack", stand: "The remaining tabs, and the moment each one earns its place in your review." }),
        [
          ["Feature Matrix", "More than twenty forensic signals - near-threshold density, pass-through ratio, dwell time, Benford deviation - each with its computed value and rating.", "When you want the raw measurements behind a rule or a driver row."],
          ["Consolidation", "How five bank files became one ledger: detected internal transfers, cross-file duplicates and the netting decisions, all reported with row references.", "When a total looks off, or you suspect the same money was counted twice."],
          ["Timeline", "The subject's complete flow history on one axis, flagged windows highlighted.", "When you need to see bursts, dormancy and regime shifts at a glance."],
          ["Network", "A graph of accounts and counterparties around the subject, sized by volume.", "When tracing where funnel inflows come from and where value exits."],
          ["Investigation Intel", "Investigator-oriented leads: repeated references, round-amount chains, counterparties worth a database check.", "When preparing the follow-up work that goes beyond the statements."],
          ["Transactions", "The full consolidated ledger - filter by bank, flagged-only, free text, or a list of transaction ids.", "When verifying any citation - rules and the AI link here pre-filtered."]
        ].map(([name, what, when], i, rows) => /* @__PURE__ */ jsxs(React.Fragment, { children: [
          i === 0 && /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", borderTopWidth: 1.5, borderTopColor: INK, paddingTop: 6, paddingBottom: 2 }, children: [
            /* @__PURE__ */ jsx(Text, { style: { width: 96, fontSize: 7.4, fontFamily: "Helvetica-Bold", color: FAINT }, children: "VIEW" }),
            /* @__PURE__ */ jsx(Text, { style: { flex: 1, fontSize: 7.4, fontFamily: "Helvetica-Bold", color: FAINT, paddingRight: 10 }, children: "WHAT IT SHOWS" }),
            /* @__PURE__ */ jsx(Text, { style: { width: 150, fontSize: 7.4, fontFamily: "Helvetica-Bold", color: FAINT }, children: "WHEN TO OPEN IT" })
          ] }),
          /* @__PURE__ */ jsxs(View, { style: { flexDirection: "row", borderTopWidth: 0.75, borderTopColor: LINE, paddingVertical: 7, borderBottomWidth: i === rows.length - 1 ? 0.75 : 0, borderBottomColor: LINE, marginBottom: i === rows.length - 1 ? 8 : 0 }, children: [
            /* @__PURE__ */ jsx(Text, { style: { width: 96, fontSize: 8.6, fontFamily: "Helvetica-Bold", color: INK }, children: name }),
            /* @__PURE__ */ jsx(Text, { style: { flex: 1, fontSize: 8.2, lineHeight: 1.45, color: INK, paddingRight: 10 }, children: what }),
            /* @__PURE__ */ jsx(Text, { style: { width: 150, fontSize: 8.2, lineHeight: 1.45, color: MUTED }, children: when })
          ] })
        ] }, i)),
        /* @__PURE__ */ jsx(Box, { title: "DEEP LINKS", color: STAND, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "Every tab is addressable. Append ?tab= and the tab name to a case address - rules, sanctions, features, consolidation, timeline, network, intelligence, ai, transactions, disposition or history - to open a case directly on that view. Useful in emails and case-review notes." }) })
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 14, title: "Portfolio analytics: rules and counterparties", stand: "Two modules that look across cases: which rules do the work, and which parties keep reappearing." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 14,
            title: "Rule Performance. Once dispositions are recorded, the split bar shows where each rule's cases ended up.",
            src: A.rulesPage,
            srcW: 1440,
            srcH: 1150,
            imgW: 340,
            notes: [
              { t: "fires portfolio-wide, latest run per case", nx: 358, ny: 10, nw: 117, fx: 0.72, fy: 0.481, bend: -0.2 },
              { t: "fills as your team records decisions - empty is honest, not broken", nx: 358, ny: 62, nw: 117, fx: 0.81, fy: 0.487, bend: -0.22, color: NOTE_WARM, rot: "-1.4deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 15,
            title: "Counterparty Intel. Cards are parties seen in more than one case; the chips underneath jump straight into each case.",
            src: A.intel,
            srcW: 1440,
            srcH: 1150,
            imgW: 340,
            notes: [
              { t: "same party, two cases - exactly what structuring networks look like", nx: 358, ny: 10, nw: 117, fx: 0.5, fy: 0.403, bend: -0.2, color: NOTE_WARM },
              { t: "click a chip to open that case", nx: 358, ny: 74, nw: 117, fx: 0.42, fy: 0.41, bend: 0.22 },
              { t: "masked references merge only on literal equality - clustering stays conservative", nx: 358, ny: 112, nw: 117, fx: 0.35, fy: 0.125, bend: 0.24, rot: "-1.5deg" }
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 15, title: "Personalization and the About page", stand: "Six appearance themes for long shifts and bright rooms - and a methodology dossier that spells out the mathematics." }),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 16,
            title: "The Paper theme: the same Command Center, re-inked for print-like reading. Appearance never changes data or scores.",
            src: A.paper,
            srcW: 1440,
            srcH: 900,
            notes: [
              { t: "themes live under the gear - pick per session, dark is the default", nx: 391, ny: 14, fx: 0.971, fy: 0.04, bend: -0.3 },
              { t: "same numbers, same layout - only the ink changes", nx: 391, ny: 78, fx: 0.49, fy: 0.28, bend: -0.18, rot: "-1.4deg" }
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          Fig,
          {
            no: 17,
            title: "About the Application: the methodology dossier. Seventeen rules, the scoring mathematics, AI boundaries and honest limitations.",
            src: A.about,
            srcW: 1440,
            srcH: 1330,
            imgW: 340,
            notes: [
              { t: "read this once - it is the maths behind every number in this manual", nx: 358, ny: 12, nw: 117, fx: 0.42, fy: 0.316, bend: 0.2, color: NOTE_WARM },
              { t: "the eight pipeline stages, each inspectable on the case page", nx: 358, ny: 76, nw: 117, fx: 0.5, fy: 0.914, bend: -0.18 }
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxs(Body, { children: [
        /* @__PURE__ */ jsx(SectionHead, { n: 16, title: "Field notes: tips and troubleshooting", stand: "The habits that make the console fast - and the first thing to check when something looks wrong." }),
        /* @__PURE__ */ jsxs(Box, { title: "WORKING HABITS", color: ACCENT, children: [
          /* @__PURE__ */ jsx(Step, { n: "1", children: "Read drivers before narrative. The top three bars usually tell the story; the AI text is the elaboration, not the source." }),
          /* @__PURE__ */ jsx(Step, { n: "2", children: "Check data quality before trusting a score. A FAIL on running-balance integrity changes how far you lean on the ledger." }),
          /* @__PURE__ */ jsx(Step, { n: "3", children: "Use View Txns links everywhere. Every rule and citation can be traced to statement rows in two clicks - do the trace for anything you plan to write in a memo." }),
          /* @__PURE__ */ jsx(Step, { n: "4", children: "Record dispositions promptly. Rule Performance only becomes useful once decisions accumulate." })
        ] }),
        /* @__PURE__ */ jsxs(Box, { title: "IF SOMETHING LOOKS WRONG", color: RED, children: [
          /* @__PURE__ */ jsx(Step, { n: "Q", children: "A file parsed fewer rows than expected. Open View Parser Logs on its intake card - sparse spreadsheet grids legitimately produce few rows, and the log says exactly what was skipped and why." }),
          /* @__PURE__ */ jsx(Step, { n: "Q", children: "The score changed between runs. Open History: a quality change, new files, or an engine version explains it. Unexplained drift is worth escalating." }),
          /* @__PURE__ */ jsx(Step, { n: "Q", children: "A sanctions match looks impossible. Check the tier - POSSIBLE means shared name parts only. Verify identifiers before reacting; the score was never touched by it." }),
          /* @__PURE__ */ jsx(Step, { n: "Q", children: "Totals differ from a bank's own statement summary. Open Consolidation - internal transfers between the subject's accounts are netted, and each netting decision is listed with its rows." })
        ] }),
        /* @__PURE__ */ jsx(Box, { title: "A LAST WORD", color: STAND, children: /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.6, lineHeight: 1.5, color: INK }, children: "The console is built on one promise: no black boxes. If you cannot see why a number is what it is, that is a defect - not a feature to work around. Every screen in this manual exists to keep that promise; use the receipts." }) })
      ] }),
      /* @__PURE__ */ jsxs(Page, { size: "A4", style: { backgroundColor: DK_BG, fontFamily: "Helvetica" }, children: [
        /* @__PURE__ */ jsx(
          Image,
          {
            src: A.markCyan,
            style: { position: "absolute", right: -84, bottom: -96, width: 390, height: 390, objectFit: "contain", opacity: 0.05 }
          }
        ),
        /* @__PURE__ */ jsxs(View, { style: { position: "absolute", left: MARGIN, right: MARGIN, top: 46, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, children: [
          /* @__PURE__ */ jsxs(View, { children: [
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 8, letterSpacing: 1.6, color: DK_SLATE }, children: "ASIA CONSULTING AND PRIVATE TRAINING" }),
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 8, letterSpacing: 1.6, color: DK_CYAN, marginTop: 4 }, children: "ASIA DATA-SCIENCE" })
          ] }),
          /* @__PURE__ */ jsx(Image, { src: A.logoWhite, style: { width: 118, height: 118 * 0.32, objectFit: "contain" } })
        ] }),
        /* @__PURE__ */ jsx(View, { style: { position: "absolute", left: MARGIN, top: 112, width: 34, height: 2, backgroundColor: DK_CYAN } }),
        /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: MARGIN, top: 150, fontSize: 8, letterSpacing: 2.2, color: DK_CYAN }, children: "THE COMPANY BEHIND THE CONSOLE" }),
        /* @__PURE__ */ jsxs(Text, { style: { position: "absolute", left: MARGIN, top: 170, fontSize: 24, lineHeight: 1.18, color: DK_TEXT, fontFamily: "Helvetica-Bold" }, children: [
          "Built so every number",
          "\n",
          "survives cross-examination."
        ] }),
        /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: MARGIN, top: 248, width: 330, fontSize: 9.2, lineHeight: 1.65, color: DK_SLATE }, children: "ASIA Consulting and Private Training is a Kuwait-based consultancy. Its ASIA Data-Science division builds decision-support systems for financial-crime analysis - pairing deterministic forensic engines with carefully bounded AI, so that every score, every flag and every narrative arrives with its evidence attached." }),
        /* @__PURE__ */ jsx(View, { style: { position: "absolute", left: MARGIN, right: MARGIN, top: 360, flexDirection: "row" }, children: [
          ["17", "TYPOLOGY RULES FROM FATF AND EGMONT GUIDANCE"],
          ["5", "BANK STATEMENT DIALECTS, ARABIC INCLUDED"],
          ["20K+", "SANCTIONS ENTRIES, REFRESHED EVERY SIX HOURS"],
          ["100%", "AI CITATIONS CHECKED AGAINST THE LEDGER"]
        ].map(([num, label], i) => /* @__PURE__ */ jsxs(View, { style: { flex: 1, borderTopWidth: 1.2, borderTopColor: DK_CYAN, paddingTop: 9, marginRight: i < 3 ? 16 : 0 }, children: [
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 17, fontFamily: "Helvetica-Bold", color: DK_CYAN }, children: num }),
          /* @__PURE__ */ jsx(Text, { style: { fontSize: 6.9, letterSpacing: 0.7, lineHeight: 1.55, color: DK_SLATE, marginTop: 5 }, children: label })
        ] }, i)) }),
        /* @__PURE__ */ jsx(View, { style: { position: "absolute", left: MARGIN, top: 486, width: 238, borderTopWidth: 1, borderTopColor: DK_CYAN, borderBottomWidth: 1, borderBottomColor: DK_CYAN, paddingVertical: 9 }, children: /* @__PURE__ */ jsxs(Text, { style: { fontSize: 9.4, letterSpacing: 1.1, lineHeight: 1.5, color: DK_TEXT, fontFamily: "Helvetica-Bold" }, children: [
          "COMMITTED TO EVIDENCE-BASED",
          "\n",
          "FINANCIAL-CRIME ANALYTICS"
        ] }) }),
        /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: 352, top: 612, width: 200, fontFamily: "Hand", fontSize: 13.5, lineHeight: 1.15, color: DK_CYAN, transform: "rotate(-2deg)" }, children: "questions? we answer the phone." }),
        /* @__PURE__ */ jsxs(Svg, { style: { position: "absolute", left: 352, top: 652 }, width: 200, height: 72, children: [
          /* @__PURE__ */ jsx(Path, { d: "M 150 6 Q 185 40 152 66", stroke: DK_CYAN, strokeWidth: 1.4, fill: "none", strokeLinecap: "round" }),
          /* @__PURE__ */ jsx(Path, { d: "M 152 66 L 154.6 59.5", stroke: DK_CYAN, strokeWidth: 1.4, strokeLinecap: "round" }),
          /* @__PURE__ */ jsx(Path, { d: "M 152 66 L 158.9 65", stroke: DK_CYAN, strokeWidth: 1.4, strokeLinecap: "round" })
        ] }),
        /* @__PURE__ */ jsxs(View, { style: { position: "absolute", left: MARGIN, right: MARGIN, bottom: 64, borderTopWidth: 0.75, borderTopColor: DK_RULE, paddingTop: 15, flexDirection: "row" }, children: [
          /* @__PURE__ */ jsxs(View, { style: { flex: 1.4 }, children: [
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 9, fontFamily: "Helvetica-Bold", color: DK_TEXT }, children: "ASIA Consulting and Private Training" }),
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 8.4, lineHeight: 1.5, color: DK_SLATE, marginTop: 3 }, children: "ASIA Data-Science" })
          ] }),
          /* @__PURE__ */ jsx(View, { style: { flex: 1 }, children: /* @__PURE__ */ jsxs(Text, { style: { fontSize: 8.4, lineHeight: 1.5, color: DK_SLATE }, children: [
            "Shayma Tower, Floor 10",
            "\n",
            "Kuwait City, Kuwait"
          ] }) }),
          /* @__PURE__ */ jsxs(View, { style: { width: 150, alignItems: "flex-end" }, children: [
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 9, fontFamily: "Helvetica-Bold", color: DK_TEXT }, children: "Tel. +965 2227 1724" }),
            /* @__PURE__ */ jsx(Text, { style: { fontSize: 9, color: DK_CYAN, marginTop: 3 }, children: "INFO@ACS-KW.COM" })
          ] })
        ] }),
        /* @__PURE__ */ jsx(Text, { style: { position: "absolute", left: MARGIN, bottom: 36, fontSize: 6.9, color: "#5E7189" }, children: "(c) 2026 ASIA Consulting and Private Training. All rights reserved." })
      ] })
    ]
  }
);
var buf = await renderToBuffer(/* @__PURE__ */ jsx(Manual, {}));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
