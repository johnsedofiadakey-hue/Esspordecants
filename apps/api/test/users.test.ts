import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { call, login, nextSecond, setup, signIn } from "./helpers.ts";

describe("Admin users", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let owner: Awaited<ReturnType<typeof login>>;
  let editorId = "";

  before(async () => {
    ctx = await setup();
    owner = await login(ctx.app);
  });

  const me = (token: string) => call(ctx.app, "GET", "/api/admin/auth/me", { headers: { authorization: `Bearer ${token}` } });

  test("owner creates an editor with a strong password", async () => {
    const weak = await owner.admin("POST", "/users", { body: { email: "ed@test.local", name: "Ed", role: "editor", password: "short" } });
    assert.equal(weak.status, 400);
    const res = await owner.admin("POST", "/users", {
      body: { email: "Ed@Test.local", name: "Ed", role: "editor", password: "editor-password-1" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.email, "ed@test.local");
    editorId = res.data.id;
    const dup = await owner.admin("POST", "/users", { body: { email: "ed@test.local", name: "Ed", role: "editor", password: "editor-password-1" } });
    assert.equal(dup.status, 409);
  });

  test("editors cannot manage users or delivery options", async () => {
    const editor = await login(ctx.app, "ed@test.local", "editor-password-1");
    assert.equal((await editor.admin("GET", "/users")).status, 403);
    assert.equal((await editor.admin("GET", "/products")).status, 200);
    const delivery = await editor.admin("POST", "/delivery-options", { body: { code: "x1", label: "X1", priceMinor: 1 } });
    assert.equal(delivery.status, 403);
  });

  test("owner cannot disable or demote themselves, and one owner must remain", async () => {
    const self = (await owner.admin("GET", "/auth/me")).data.user.id;
    assert.equal((await owner.admin("PATCH", `/users/${self}`, { body: { disabled: true } })).status, 400);
    assert.equal((await owner.admin("PATCH", `/users/${self}`, { body: { role: "editor" } })).status, 400);
    const users = await owner.admin("GET", "/users");
    assert.equal(users.data.items.filter((user: { role: string }) => user.role === "owner").length, 1);
  });

  test("disabling a user revokes their tokens and blocks sign-in", async () => {
    const { token } = await signIn("ed@test.local", "editor-password-1");
    assert.equal((await me(token)).status, 200);
    await nextSecond();
    const res = await owner.admin("PATCH", `/users/${editorId}`, { body: { disabled: true } });
    assert.equal(res.data.disabled, true);
    assert.equal((await me(token)).status, 401);
    assert.notEqual((await signIn("ed@test.local", "editor-password-1")).status, 200);
    await owner.admin("PATCH", `/users/${editorId}`, { body: { disabled: false } });
    await nextSecond();
    assert.equal((await me((await signIn("ed@test.local", "editor-password-1")).token)).status, 200);
  });

  test("owner reset signs the user out; new password works", async () => {
    const { token } = await signIn("ed@test.local", "editor-password-1");
    await nextSecond();
    assert.equal((await owner.admin("POST", `/users/${editorId}/password`, { body: { password: "reset-password-22" } })).status, 200);
    assert.equal((await me(token)).status, 401);
    assert.notEqual((await signIn("ed@test.local", "editor-password-1")).status, 200);
    await nextSecond();
    assert.equal((await me((await signIn("ed@test.local", "reset-password-22")).token)).status, 200);
  });
});
