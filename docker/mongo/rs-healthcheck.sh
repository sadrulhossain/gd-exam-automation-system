#!/bin/sh
# Idempotent single-node replica set bootstrap + health probe.
# Healthy only once this node is the writable primary of replica set "rs0".
# Credentials are read from MONGO_INITDB_ROOT_* when set (production).
exec mongosh --quiet --eval '
const user = process.env.MONGO_INITDB_ROOT_USERNAME;
if (user) db.getSiblingDB("admin").auth(user, process.env.MONGO_INITDB_ROOT_PASSWORD);
try {
  rs.status();
} catch (e) {
  try {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  } catch (_) {}
  quit(1);
}
const hello = db.hello();
quit(hello.setName === "rs0" && hello.isWritablePrimary ? 0 : 1);
'
