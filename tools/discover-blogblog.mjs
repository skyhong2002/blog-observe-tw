import { createDb } from "../src/db.mjs";
import { discoverBlogblog } from "../src/discovery.mjs";
const store = createDb();
try { console.log(JSON.stringify(await discoverBlogblog(store), null, 2)); } finally { await store.close(); }
