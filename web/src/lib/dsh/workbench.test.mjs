import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_WORKBENCH,
  workbenchReducer as reduce,
  restoreWorkbench,
  panelGeometry,
  browserAddress,
  fileKind,
  lineChanges,
} from "./workbench.ts";
const file = { id: "file:a.md", kind: "file", title: "a.md", path: "a.md" };
test("opening the same resource focuses its existing tab", () => {
  const one = reduce(INITIAL_WORKBENCH, { type: "open", tab: file });
  const two = reduce(one, { type: "open", tab: file });
  assert.equal(two.tabs.length, 1);
  assert.equal(two.active, file.id);
  assert.equal(two.open, true);
});
test("close selects adjacent tab; hide preserves resources; last close clears fullscreen", () => {
  let s = reduce(INITIAL_WORKBENCH, { type: "open", tab: file });
  s = reduce(s, { type: "open", tab: { id: "files", kind: "files", title: "文件" } });
  assert.equal(reduce(s, { type: "hide" }).tabs.length, 2);
  s = reduce(s, { type: "fullscreen" });
  s = reduce(s, { type: "close", id: "files" });
  assert.equal(s.active, file.id);
  s = reduce(s, { type: "close", id: file.id });
  assert.equal(s.active, null);
  assert.equal(s.open, false);
  assert.equal(s.fullscreen, false);
});
test("restore validates stored state and removes duplicate resources", () => {
  assert.deepEqual(restoreWorkbench("bad json"), INITIAL_WORKBENCH);
  assert.equal(
    restoreWorkbench(
      JSON.stringify({
        tabs: [file, file, { id: 3 }, { id: "x", kind: "remote", title: "x" }],
        active: "missing",
        open: true,
      }),
    ).tabs.length,
    1,
  );
  assert.equal(restoreWorkbench(JSON.stringify({ tabs: [file], fullscreen: true })).fullscreen, false);
});
test("layout protects the center and uses an overlay on narrow viewports", () => {
  assert.deepEqual(panelGeometry(1600, 280), { width: 720, overlay: false });
  assert.deepEqual(panelGeometry(1100, 280, 900), { width: 420, overlay: false });
  assert.equal(panelGeometry(700, 56).overlay, true);
});
test("browser address accepts loopback but rejects active protocols", () => {
  assert.equal(browserAddress("localhost:3000"), "http://localhost:3000/");
  assert.equal(browserAddress("http://127.0.0.1:3000"), "http://127.0.0.1:3000/");
  assert.equal(browserAddress("example.com"), "https://example.com/");
  assert.equal(browserAddress("javascript:alert(1)"), null);
  assert.equal(browserAddress("data:text/html,x"), null);
});
test("file renderers and change review preserve unchanged context", () => {
  assert.equal(fileKind("README.MD"), "markdown");
  assert.equal(fileKind("screen.webp"), "image");
  assert.equal(fileKind("log.csv"), "table");
  assert.deepEqual(
    lineChanges("a\nb\nc", "a\nx\nc").map((r) => [r.type, r.text]),
    [
      ["same", "a"],
      ["remove", "b"],
      ["add", "x"],
      ["same", "c"],
    ],
  );
});

test("CSV preview keeps quoted separators, multiline cells and escaped quotes", async () => {
  const { parseDelimited } = await import("./workbench.ts");
  assert.deepEqual(parseDelimited('name,note\r\n"a,b","line1\nline2"\r\n"x""y",z\r\n'), [
    ["name", "note"],
    ["a,b", "line1\nline2"],
    ['x"y', "z"],
  ]);
  assert.equal(parseDelimited("a\nb\nc", ",", 2).length, 2);
  assert.deepEqual(parseDelimited("a\tb\n", "\t"), [["a", "b"]]);
});

test("conversation URL restoration retains valid ids and rejects malformed selections", async () => {
  const { conversationId } = await import("./workbench.ts");
  assert.equal(conversationId(new URLSearchParams("c=17&approval=1")), 17);
  for (const query of ["", "new=1", "c=0", "c=-1", "c=1.5", "c=NaN", "c=9007199254740992"])
    assert.equal(conversationId(new URLSearchParams(query)), null);
});
test('task inspector restores valid task/section and rejects corrupted resources', () => {
 const tab={id:'task:1:findings',kind:'task',title:'任务 #1 · 发现',taskId:'1',section:'findings'};
 assert.equal(restoreWorkbench(JSON.stringify({tabs:[tab],active:tab.id,open:true})).tabs.length,1);
 for(const bad of [{...tab,taskId:'no-id'},{...tab,section:'unknown'},{...tab,taskId:undefined}])assert.equal(restoreWorkbench(JSON.stringify({tabs:[bad]})).tabs.length,0);
});
