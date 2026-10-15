const { hashPassword } = require("../auth");

async function main() {
  const plainPassword = process.argv[2];
  if (!plainPassword) {
    console.error(
      'Cách dùng: node scripts/generate_password_hash.js "mật_khẩu_cần_băm"',
    );
    process.exit(1);
  }

  const hash = await hashPassword(plainPassword);
  console.log(hash);
}

main();
