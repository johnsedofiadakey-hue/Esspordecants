// Creates an admin (Firebase Auth user + admins record).
//   Emulators:  npm run admin:create -- --email you@example.com --name "Your Name" --role owner
//   Live:       npm run admin:create:live -- --email you@example.com --name "Your Name" --role owner
// The live variant uses your Application Default Credentials (gcloud auth application-default login).
// The password comes from ADMIN_PASSWORD or a hidden prompt; it is never printed.
import readline from "node:readline";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import { openStore } from "../src/firebase.ts";
import { createAdmin, MIN_PASSWORD_LENGTH } from "../src/routes/admin/users.ts";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "editor" } },
});
if (!values.email || !values.name || !["owner", "editor"].includes(values.role ?? "")) {
  console.error('Usage: npm run admin:create[:live] -- --email you@example.com --name "Your Name" [--role owner|editor]');
  process.exit(1);
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    output._writeToOutput = (text: string) => {
      if (text.includes(question)) output.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const config = loadConfig();
const live = !process.env.FIRESTORE_EMULATOR_HOST;
console.log(`Target: ${live ? `LIVE project ${config.projectId}` : `emulators (${config.projectId})`}`);
const password = process.env.ADMIN_PASSWORD || (await promptHidden("Password: "));
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
const store = openStore(config);
const { id } = await createAdmin(store, {
  email: values.email.toLowerCase(),
  name: values.name,
  role: values.role as "owner" | "editor",
  password,
});
console.log(`Created ${values.role} ${values.email} (uid ${id}).`);
process.exit(0);
