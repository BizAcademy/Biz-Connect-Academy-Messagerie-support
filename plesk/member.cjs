"use strict";
try {
  require("./verify.cjs").verifyRelease();
  require("./environment.cjs")();
  import("./server/member.mjs").catch(() => {
    console.error("Création membre échouée. Vérifier la base et les variables MEMBER_USERNAME / MEMBER_NUMBER.");
    process.exitCode = 1;
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
