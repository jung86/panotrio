const fs = require('fs');
(async () => {
  for (const n of process.argv.slice(2)) {
    const S = await require('./' + n + '.js')();
    const vp = await S.close();
    fs.writeFileSync(n + '.json', JSON.stringify({ video: vp, marks: S.marks, errs: S.errs, frames: S.frames }));
    console.log(n, vp, JSON.stringify(S.marks), S.errs);
  }
})();
