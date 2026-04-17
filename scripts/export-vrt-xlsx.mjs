import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const ROOT_DIR = process.cwd();
const DEFAULT_JSON_REPORT = path.join(ROOT_DIR, 'playwright-report', 'results.json');
const DEFAULT_XLSX_OUTPUT = path.join(ROOT_DIR, 'playwright-report', 'vrt-results.xlsx');
const DEFAULT_HTML_REPORT = path.join(ROOT_DIR, 'playwright-report', 'index.html');

function parseArgs(argv) {
  const options = {
    input: DEFAULT_JSON_REPORT,
    output: DEFAULT_XLSX_OUTPUT,
    html: DEFAULT_HTML_REPORT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      options.input = path.resolve(ROOT_DIR, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--output' && argv[i + 1]) {
      options.output = path.resolve(ROOT_DIR, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--html' && argv[i + 1]) {
      options.html = path.resolve(ROOT_DIR, argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

function readJsonReport(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Playwright JSON レポートが見つかりません: ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
}

function parseUrlFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function buildUrlMap() {
  const urlsDir = path.join(ROOT_DIR, 'tests');
  const listA = parseUrlFile(path.join(urlsDir, 'urls-a.txt'));
  const listB = parseUrlFile(path.join(urlsDir, 'urls-b.txt'));
  const urlMap = new Map();

  const max = Math.min(listA.length, listB.length);
  for (let i = 0; i < max; i++) {
    const urlA = listA[i];
    const urlB = listB[i];
    if (urlB === '-') continue;

    const pageName = new URL(urlA).pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'top';
    urlMap.set(pageName, { urlA, urlB });
  }

  return urlMap;
}

function extractPageName(title = '') {
  const match = title.match(/^VRT:\s*(.+)$/);
  return match ? match[1] : title;
}

function toRelative(p) {
  if (!p) return '';
  const absolute = path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p);
  return path.relative(ROOT_DIR, absolute);
}

function summarizeAttachments(results) {
  const paths = [];
  for (const result of results ?? []) {
    for (const attachment of result.attachments ?? []) {
      if (attachment.path) {
        paths.push(toRelative(attachment.path));
      }
    }
  }
  return [...new Set(paths)].join('\n');
}

function collectTests(suite, rows, urlMap, htmlReportPath) {
  for (const child of suite.suites ?? []) {
    collectTests(child, rows, urlMap, htmlReportPath);
  }

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const lastResult = results.length > 0 ? results[results.length - 1] : undefined;
      const status = test.status ?? test.outcome ?? lastResult?.status ?? 'unknown';
      const project = test.projectName ?? '';
      const pageName = extractPageName(spec.title);
      const pair = urlMap.get(pageName) ?? { urlA: '', urlB: '' };
      const durationMs = results.reduce((sum, item) => sum + (item.duration ?? 0), 0);
      const errors = results
        .flatMap((item) => item.errors ?? [])
        .map((error) => error.message || '')
        .filter(Boolean)
        .join('\n');

      rows.push({
        executedAt: new Date().toISOString(),
        project,
        pageName,
        testTitle: spec.title,
        status,
        expectedStatus: test.expectedStatus ?? '',
        retry: test.retry ?? 0,
        durationMs,
        urlA: pair.urlA,
        urlB: pair.urlB,
        htmlReport: toRelative(htmlReportPath),
        attachments: summarizeAttachments(results),
        errors,
      });
    }
  }
}

function createSummary(rows) {
  const byProject = new Map();
  for (const row of rows) {
    const key = row.project || 'unknown';
    const current = byProject.get(key) ?? { project: key, total: 0, passed: 0, failed: 0, skipped: 0 };
    current.total += 1;
    if (row.status === 'passed') current.passed += 1;
    else if (row.status === 'failed' || row.status === 'timedOut') current.failed += 1;
    else current.skipped += 1;
    byProject.set(key, current);
  }
  return Array.from(byProject.values());
}

function writeWorkbook(outputPath, rows) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const workbook = xlsx.utils.book_new();
  const resultSheet = xlsx.utils.json_to_sheet(rows);
  const summarySheet = xlsx.utils.json_to_sheet(createSummary(rows));

  xlsx.utils.book_append_sheet(workbook, resultSheet, 'VRT Results');
  xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  xlsx.writeFile(workbook, outputPath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = readJsonReport(options.input);
  const rows = [];
  const urlMap = buildUrlMap();

  for (const suite of report.suites ?? []) {
    collectTests(suite, rows, urlMap, options.html);
  }

  writeWorkbook(options.output, rows);

  console.log(`Excel レポートを出力しました: ${toRelative(options.output)}`);
  console.log(`対象テスト件数: ${rows.length}`);
}

main();
