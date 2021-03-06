import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import glob from "glob";

const i18nFile = path.resolve(process.cwd(), "i18n.json");

let debug: boolean = false;

var myArgs = process.argv.slice(2);

switch (myArgs[0]) {
  case "--debug":
    console.log("Debug mode on");
    debug = true;
    break;
  default:
    console.log("Building with next-locale...");
}

/* Check for i18n.json */
if (!fs.existsSync(i18nFile)) {
  console.warn(`Please put i18n.json at the root.`);
  process.exit(1);
}

/* Parse i18n.json */
var json = JSON.parse(fs.readFileSync(i18nFile, "utf8"));

/* Assign each object */
const {
  allLanguages = [],
  currentPagesDir = "pages_",
  defaultLanguage = "en",
  finalPagesDir = "pages",
  localesPath = "locales",
  pages = {},
}: {
  allLanguages: string[];
  currentPagesDir: string;
  defaultLanguage: string;
  finalPagesDir: string;
  localesPath: string;
  pages: {};
} = json;

console.log(
  allLanguages,
  currentPagesDir,
  defaultLanguage,
  finalPagesDir,
  localesPath,
  pages,
);

/* Check for currentPagesDir */
if (!fs.existsSync(currentPagesDir)) {
  console.warn(`Please put currentPagesDir at root.`);
  process.exit(1);
}

/* Clean up finalPagesDir */
rimraf.sync(finalPagesDir);

/* Try mkdir finalPagesDir */
try {
  fs.mkdirSync(finalPagesDir);
} catch (e) {}

/* Add all pages to array */
const parsedDir = currentPagesDir.replace(/\\/g, "/");
const allPages = glob.sync(parsedDir + "/**/*.*").sort();

function clearPageExt(page: string): string {
  const rgx = /(\/index\.jsx)|(\/index\.js)|(\/index\.tsx)|(\/index\.ts)|(\/index\.mdx)|(\.jsx)|(\.js)|(\.tsx)|(\.ts)|(\.mdx)/gm;
  return page.replace(rgx, "");
}

/* Get namespace for a page */
function getPageNamespaces(pageId: string): string[] {
  //@ts-ignore
  const allNamespace = pages["*"];
  //@ts-ignore
  const pageNamespace = pages[pageId] ?? null;

  const namespaces = pageNamespace
    ? allNamespace.concat(pageNamespace)
    : allNamespace;

  return namespaces;
}

/* Build namespaces for each page */
allPages.forEach(async page => {
  const pageId =
    clearPageExt(page.replace(currentPagesDir, "")).replace(/\/index$/, "") ||
    "/";

  const namespaces = await getPageNamespaces(pageId);

  console.log(pageId, namespaces);
  buildPageInAllLocales(page, namespaces);
});

/* Check if custom next page */
function isNextInternal(pagePath: string): boolean {
  return (
    pagePath.startsWith(`${currentPagesDir}/_`) ||
    pagePath.startsWith(`${currentPagesDir}/404.`) ||
    pagePath.startsWith(`${currentPagesDir}/api/`)
  );
}

/* Check if page has a particular export name */
function hasExportName(data: string, name: string): RegExpMatchArray | null {
  return data.match(
    new RegExp(`export (const|var|let|async function|function) ${name}`),
  );
}

/* Export special next.js method */
function specialMethod(name: string): string {
  return `\nexport const ${name} = ctx => _rest.${name}({...ctx});`;
}

/* Export all from each page */
function exportAllFromPage(
  page: string,
): {
  hasSomeSpecialMethod: RegExpMatchArray | null;
  exports: string;
} {
  const clearCommentsRgx = /\/\*[\s\S]*?\*\/|\/\/.*/g;
  const pageData = fs
    .readFileSync(page)
    .toString("utf8")
    .replace(clearCommentsRgx, "");

  const isGetStaticProps = hasExportName(pageData, "getStaticProps");
  const isGetStaticPaths = hasExportName(pageData, "getStaticPaths");
  const isGetServerSideProps = hasExportName(pageData, "getServerSideProps");
  const hasSomeSpecialMethod =
    isGetStaticProps || isGetStaticPaths || isGetServerSideProps;

  let exports: string = "";

  if (isGetStaticPaths) {
    exports += specialMethod("getStaticPaths");
  }
  if (isGetStaticProps) {
    exports += specialMethod("getStaticProps");
  }
  if (isGetServerSideProps) {
    exports += specialMethod("getServerSideProps");
  }
  if (exports !== "") {
    exports += "\n";
  }

  return {hasSomeSpecialMethod, exports};
}

/* Get page template */
function getPageTemplate(
  prefix: string,
  page: string,
  namespaces: string[],
): string {
  const {hasSomeSpecialMethod, exports} = exportAllFromPage(page);

  return `// @ts-nocheck
import {useRouter} from "next/router";
import I18nProvider from "next-locale/I18nProvider";
import React from "react";
import C${
    hasSomeSpecialMethod ? ", * as _rest" : ""
  } from "${prefix}/${clearPageExt(page)}";
${allLanguages
  .map(lang =>
    namespaces
      .map(
        (ns, i) =>
          `import ${lang}${i} from "${prefix}/${localesPath}/${lang}/${ns}.json";`,
      )
      .join("\n"),
  )
  .join("\n")}
const namespaces = {\n${allLanguages
    .map(lang =>
      namespaces.map(
        (ns, i) => `${i === 0 ? `  ${lang}: {` : " "}${ns}: ${lang}${i}`,
      ),
    )
    .join("},\n")}},\n};
${exports}
export default function Page(p) {
  const router = useRouter();
  const {locale} = router;

  return (
    <I18nProvider${
      debug ? " debug" : ""
    } locale={locale} namespaces={namespaces}>
      <C {...p} />
    </I18nProvider>
  );
}
`;
}

/* Build page for locale */
function buildPageLocale({
  prefix,
  pagePath,
  namespaces,
  path,
}: {
  prefix: string;
  pagePath: string;
  namespaces: string[];
  path: string;
}): void {
  const finalPath = pagePath.replace(currentPagesDir, path);
  const template = getPageTemplate(prefix, pagePath, namespaces);
  const [filename] = finalPath.split("/").reverse();
  const dirs = finalPath.replace(`/${filename}`, "");

  fs.mkdirSync(dirs, {recursive: true});
  fs.writeFileSync(finalPath, template);
}

/* Build page for all locales */
function buildPageInAllLocales(pagePath: string, namespaces: string[]): void {
  let prefix = pagePath
    .split("/")
    .map(() => "..")
    .join("/");
  let rootPrefix = prefix.replace("/..", "");

  if (isNextInternal(pagePath)) {
    fs.copyFileSync(pagePath, pagePath.replace(currentPagesDir, finalPagesDir));
    return;
  }
  buildPageLocale({
    namespaces,
    pagePath,
    path: finalPagesDir,
    prefix: rootPrefix,
  });
}
