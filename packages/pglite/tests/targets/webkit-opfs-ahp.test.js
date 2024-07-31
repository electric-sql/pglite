import { tests } from "./base.js";

// There is an issue with webkit opening more than 252 access handles, this
// prevents the opfs-ahp VFS working on webkit. :-(
// tests("webkit", "opfs-ahp://base", "webkit.opfs-ahp");
