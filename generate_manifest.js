const fetch = require("node-fetch");
const fs = require("fs/promises");
const path = require("path");

async function getLatestVersionAndTotalDownloads(repoUrl) {
  const [owner, repo] = repoUrl.replace("https://github.com/", "").split("/");
  const releasesBaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;

  let page = 1;
  const perPage = 100;
  let allReleases = [];
  let hasMore = true;

  while (hasMore) {
    const url = `${releasesBaseUrl}?per_page=${perPage}&page=${page}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch releases from ${url}`);
    }

    const releases = await response.json();
    allReleases = allReleases.concat(releases);

    hasMore = releases.length === perPage;
    page++;
  }

  if (allReleases.length === 0) {
    return { version: "0.0.1", totalDownloads: 0 };
  }

  // Log release download info
  allReleases.forEach((release) => {
    const releaseTag = release.tag_name || "<no-tag>";
    const downloadCount = release.assets.reduce(
      (sum, asset) => sum + asset.download_count,
      0
    );
  });

  const latestRelease =
    allReleases.find((r) => !r.prerelease) || allReleases[0];
  const version = latestRelease.tag_name || "0.0.1";

  const totalDownloads = allReleases.reduce((sum, release) => {
    return (
      sum +
      release.assets.reduce((aSum, asset) => aSum + asset.download_count, 0)
    );
  }, 0);

  return { version, totalDownloads };
}

async function buildCombinedManifest(sourceFilePath, outputFilePath) {
  const sourceData = JSON.parse(await fs.readFile(sourceFilePath, "utf8"));
  let existingManifest = [];

  try {
    existingManifest = JSON.parse(await fs.readFile(outputFilePath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const combined = [];
  const updatedPlugins = [];

  for (const entry of sourceData) {
    const manifestResp = await fetch(entry.manifest);
    if (!manifestResp.ok) {
      console.error(`Failed to fetch manifest: ${entry.manifest}`);
      continue;
    }

    const manifest = await manifestResp.json();
    const repoUrl = entry.repo;
    const { version: latestVersion, totalDownloads } =
      await getLatestVersionAndTotalDownloads(repoUrl);
    const downloadLink = `${repoUrl}/releases/latest/download/latest.zip`;

    const existingEntry = existingManifest.find((e) => e.RepoUrl === repoUrl);
    const versionChanged =
      !existingEntry || existingEntry.AssemblyVersion !== latestVersion;

    if (versionChanged) {
      updatedPlugins.push(`${manifest.Name} ${latestVersion}`);
    }

    const enriched = {
      ...manifest,
      InternalName: manifest.InternalName ?? manifest.Name.replaceAll(" ", ""),
      RepoUrl: repoUrl,
      DownloadLinkInstall: downloadLink,
      DownloadLinkUpdate: downloadLink,
      AssemblyVersion: latestVersion,
      DownloadCount: versionChanged
        ? totalDownloads
        : existingEntry?.DownloadCount ?? totalDownloads,
      LastUpdated: versionChanged
        ? Date.now()
        : existingEntry?.LastUpdated ?? Date.now(),
    };

    combined.push(enriched);
  }

  await fs.writeFile(outputFilePath, JSON.stringify(combined, null, 4), "utf8");
  console.log(`Manifest written to ${outputFilePath}`);

  if (updatedPlugins.length > 0) {
    const commitMessage = updatedPlugins.join(", ");
    console.log(`Suggested commit message:\n${commitMessage}`);
  } else {
    console.log("No plugins updated; no commit message necessary.");
  }
}

buildCombinedManifest("plugins.json", "manifest.json");