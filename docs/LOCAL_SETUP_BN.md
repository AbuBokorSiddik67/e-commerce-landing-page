# লোকাল কম্পিউটারে LANDIQ চালানোর নিয়ম

এই নির্দেশিকা **শুধু নতুন, খালি local development database**-এর জন্য। আগে থেকে চলমান দোকান বা গুরুত্বপূর্ণ ডেটাবেসে এই ধাপগুলো চালাবেন না। কোনো reset, `db push` বা পুরোনো ডেটা মুছে ফেলার নির্দেশ এখানে নেই। Production-এর জন্য [DEPLOYMENT.md](DEPLOYMENT.md) দেখুন; বর্তমান সংস্করণ এখনো production-ready নয়।

## ১. যা লাগবে

- Node.js 22.12+ (Node 22 LTS ভালো) ও npm; Linux/macOS অথবা Windows-এ WSL2-এর একটি Bash terminal। Embedded PostgreSQL-এর জন্য আপনার OS/CPU সমর্থিত হতে হবে; root হিসেবে চালাবেন না।
- 3000 ও 55432 পোর্ট খালি থাকতে হবে। প্রথমবার package এবং **official Prisma engine** ডাউনলোডের জন্য ইন্টারনেট দরকার।
- একটি নতুন local checkout; repository-তে আগে থেকেই `.postgres-data` থাকলে সেটিকে খালি ধরে নেবেন না।

এখানে বর্ণিত official Prisma CLI দিয়ে পুরো fresh-install flow এই পরীক্ষার পরিবেশে যাচাই করা যায়নি: engine download-এ TLS বাধা ছিল। Synthetic database-এ migration SQL ও bootstrap পরীক্ষা হয়েছে, কিন্তু তা CLI verification-এর বিকল্প নয়। TLS যাচাই বন্ধ করে বা অজানা binary ব্যবহার করে বাধা এড়াবেন না।

## ২. Package এবং `.env` তৈরি

Repository folder-এ Bash খুলুন:

```bash
npm ci --ignore-scripts
test -f .env || cp .env.example .env
```

এবার `.env` সম্পাদক দিয়ে খুলে নিচের তিনটি মান ঠিক করুন (অন্য optional provider সেটিংস খালি রাখতে পারেন):

```dotenv
DATABASE_URL="postgresql://landiq:landiq_dev_password@127.0.0.1:55432/landiq"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
CREDENTIALS_ENCRYPTION_KEY="নিজের-তৈরি-র্যান্ডম-সিক্রেট"
```

উপরের শেষ মানটি উদাহরণ, হুবহু ব্যবহার করবেন না। আলাদা একটি দীর্ঘ key তৈরি করতে পারেন:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

ফলাফলটি `.env`-এ বসান, নিরাপদে রাখুন এবং কারও সঙ্গে শেয়ার/commit করবেন না। নতুন key-টি স্থির রাখুন; পুরোনো installation-এর key বদলানোর আগে [key পরিবর্তনের সতর্কতা](DEPLOYMENT.md#credential-key-and-existing-installations) পড়ুন। `landiq_dev_password` শুধু এই loopback local helper-এর পরিচিত development password—production বা network-accessible database-এ ব্যবহার করবেন না।

## ৩. Database চালু করুন

**Terminal A**-তে repository folder থেকে চালিয়ে খোলা রাখুন:

```bash
npm run db:dev
```

`PostgreSQL ready on port 55432` দেখানো পর্যন্ত অপেক্ষা করুন। এটি `.postgres-data/`-তে ডেটা রাখে; বন্ধ করলেও ডেটা থেকে যায়। নতুন cluster UTF-8 ব্যবহার করে। পুরোনো non-UTF8 cluster থাকলে helper সতর্ক করবে; সেটি না বুঝে মুছবেন বা পুনরায় initialize করবেন না।

**Terminal B**-তে একই repository folder খুলুন। অন্য কোনো writer/application এই DB ব্যবহার করছে না নিশ্চিত করে নতুন-খালি DB-এর read-only preflight চালান:

```bash
npm run db:check-empty
```

এটি `.env`-এর কার্যকর `DATABASE_URL`, লোকাল process/data directory, port, database/user, UTF-8 এবং খালি schema পরীক্ষা করে। `Verified empty UTF8 local development database` না দেখালে **এখানেই থামুন**। এটি শুধু এই embedded development cluster-এর জন্য; production বা অন্য DB নিরাপদ প্রমাণ করে না। Shell-এ আগে থেকে export করা `DATABASE_URL` থাকলে সেটি `.env`-কে override করতে পারে। কোনো গুরুত্বপূর্ণ ডেটা মুছে সমস্যার সমাধান করবেন না।

## ৪. প্রথমবার schema ও owner তৈরি

শুধু উপরের preflight সফল হলে, **Terminal B**-তে:

```bash
npm run prisma:generate
npm run prisma:deploy
```

এগুলো normal Prisma CLI ব্যবহার করে। কোনো ধাপ ব্যর্থ হলে থামুন এবং error সমাধান করুন; `db push` বা reset দিয়ে এগোবেন না। `prisma:deploy` খালি লোকাল DB-তে schema লেখে। Existing installation-এর জন্য এই নির্দেশ নয়।

তারপর নিজের owner email ও একটি অনন্য password দিয়ে **একবারই** seed করুন। Password অন্তত ১৬ অক্ষর এবং সর্বোচ্চ ৭২ UTF-8 byte হতে হবে। নিচের prompt-এ password টাইপ করার সময় দেখা যাবে না:

```bash
read -r -p 'Owner email: ' SEED_OWNER_EMAIL
read -r -s -p 'Owner password: ' SEED_OWNER_PASSWORD; echo
export SEED_OWNER_EMAIL SEED_OWNER_PASSWORD
SEED_INCLUDE_DEMO=true npm run db:seed
unset SEED_OWNER_EMAIL SEED_OWNER_PASSWORD
```

`true` দিলে একটি demo product/page ও তার opening stock তৈরি হবে। Demo না চাইলে `SEED_INCLUDE_DEMO=false` দিন। Seed প্রতিটি application table খালি আছে কি না দেখে; ডেটা থাকলে থেমে যায়। Owner password কোথাও লগ করে না। `.env`-এ seed password লিখে থাকলে সফল seed-এর পর সেটি সরিয়ে দিন; login-এর জন্য password নিরাপদ password manager-এ রাখুন। আগে চালানো দোকানে seed আবার চালাবেন না।

## ৫. Application চালু ও ব্যবহার

**Terminal A**-তে database চালু রেখে **Terminal B**-তে:

```bash
npm run dev
```

- ব্রাউজারে [http://localhost:3000/login](http://localhost:3000/login) খুলে নিজের seed করা owner দিয়ে sign in করুন। কোনো default owner password নেই।
- Demo seed করলে [http://localhost:3000/shop](http://localhost:3000/shop) এবং `/p/premium-cotton-t-shirt` দেখতে পারবেন। অন্যথায় dashboard থেকে product, stock ও landing page তৈরি করে publish করুন। COD প্রথম seed-এ enabled থাকে।
- Cart-এর প্রতিটি line আলাদা order হয়। Confirmation/tracking link ব্যক্তিগত: এটি যার কাছে থাকে তিনি order দেখতে বা যোগ্য pending COD order cancel করতে পারেন।
- Return-এর courier status একা stock বাড়ায় না: বাস্তবে পণ্য হাতে পেয়ে receipt ও inspection রেকর্ড করতে হয়। Refund record মানেই টাকা ফেরত গেছে—এমন নয়।
- Payment gateway, courier API, SMTP, SMS ও S3-এর জন্য আলাদা অনুমোদন/credential এবং বাস্তব sandbox test প্রয়োজন; স্থানীয় COD ব্যবহার করতে এগুলো লাগবে না।

বন্ধ করতে প্রতিটি terminal-এ `Ctrl+C` দিন। পরে চালাতে Terminal A-তে `npm run db:dev`, Terminal B-তে `npm run dev` যথেষ্ট; স্বাভাবিকভাবে আবার seed বা migration চালানোর দরকার নেই।

## সমস্যা হলে

- **Prisma TLS/download error:** বিশ্বাসযোগ্য নেটওয়ার্ক/CA ও `binaries.prisma.sh`-এর access যাচাই করুন। এই পরিবেশে official download ব্যর্থ হয়েছিল; TLS bypass করবেন না।
- **Port in use:** কোন process পোর্টটি ব্যবহার করছে আগে যাচাই করুন। অন্য একটি database-কে এই নতুন database ধরে নিয়ে migration/seed চালাবেন না।
- **`db:check-empty` refuses:** `.env`, `PG_PORT`, cluster identity বা পুরোনো ডেটা আছে কি না দেখুন। এটি migration-এর পরে স্বাভাবিকভাবেই আর সফল হবে না। বিদ্যমান ডেটার ক্ষেত্রে থামুন।
- **Seed refuses:** ইতিমধ্যে কোনো application table-এ data আছে; অনুমান করে ডেটা মুছবেন না। Seed upgrade বা password-reset tool নয়।
- **Login/password ভুলে গেলে:** SMTP configured থাকলে password-reset flow ব্যবহার করুন। Link ডিফল্টভাবে UI-তে দেখায় না। শুধু আলাদা, বাস্তব ডেটাবিহীন local DB-তে পরীক্ষার জন্য, অন্য app server বন্ধ করে `LANDIQ_SHOW_DEV_RESET_LINK=1 npx next dev -H 127.0.0.1` চালিয়ে reset link UI-তে দেখতে পারেন। Link secret; পরীক্ষার পরে server বন্ধ করে flag ছাড়া চালান। Network/public preview বা production-এ কখনো এটি ব্যবহার করবেন না—যে কেউ email দিয়ে account reset করতে পারবে।

আরও তথ্য: [ENVIRONMENT.md](ENVIRONMENT.md), [DATABASE.md](DATABASE.md), [TESTING.md](TESTING.md)।
