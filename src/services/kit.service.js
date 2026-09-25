const { getDatabase } = require("../config/database");

async function listKitsForUser(userId) {
  const kits = await getDatabase()
    .collection("kits")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  return kits.map((kit) => ({
    id: kit._id.toString(),
    title: kit.title,
    createdAt: kit.createdAt,
  }));
}

module.exports = {
  listKitsForUser,
};
