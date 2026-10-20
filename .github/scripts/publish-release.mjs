import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const repo = process.env.GITHUB_REPOSITORY || "amiaoapp/qimiao";
const tag = `v${version}`;
const release = JSON.parse(execFileSync("gh", ["release", "view", tag, "--repo", repo, "--json", "assets,isDraft,url"], { encoding: "utf8" }));
const assets = release.assets;
if (!assets.length || assets.some((asset) => !/^qimiao[-_]/i.test(asset.name) || !asset.name.includes(version) || asset.state !== "uploaded" || asset.size <= 0)) {
  throw new Error("Release has missing, incomplete or incorrectly named assets");
}
const required = [
  /_aarch64\.dmg$/, /_x64\.dmg$/, /_x64-setup\.exe$/,
  /_amd64\.deb$/, /_arm64\.deb$/, /_amd64\.AppImage$/, /_aarch64\.AppImage$/,
  /\.x86_64\.rpm$/, /\.aarch64\.rpm$/, /_aarch64\.app\.tar\.gz$/, /_x64\.app\.tar\.gz$/,
];
for (const suffix of required) {
  if (!assets.some((asset) => suffix.test(asset.name))) throw new Error(`Missing installer: ${suffix}`);
}
execFileSync("gh", ["release", "edit", tag, "--repo", repo, "--draft=false", "--latest"], { stdio: "inherit" });
console.log(`Published ${release.url} with ${assets.length} verified downloads`);
