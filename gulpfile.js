var gulp        = require('gulp');
var del         = require("del");

gulp.task("clean", function(){
    return del([
        "index.js", "index.d.ts",
        "SteamBot.js", "SteamBot.d.ts",
        "examples/*"
    ]);
});
