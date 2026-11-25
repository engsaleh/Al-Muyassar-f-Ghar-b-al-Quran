# رفع «الميسر في غريب القرآن» إلى GitHub

هذه الحزمة تضم التطبيق وبياناته وخطوطه محليًا. مجلد `dist` هو الموقع الجاهز للنشر، ولا يحتاج خطوة بناء أو مفاتيح API أو تثبيت حزم npm.

## 1. إنشاء المستودع ورفع الملفات

1. فك ضغط الحزمة على جهازك، وافتح مجلد `muyassar-ghareeb-al-quran` الناتج.
2. في GitHub، اختر **New repository**. اسم مقترح للمستودع: `muyassar-ghareeb-al-quran`.
3. اختر ظهور المستودع الذي تريده. لنشر الموقع عبر GitHub Pages في الخطة المجانية، استخدم مستودعًا عامًا؛ دعم Pages في المستودعات الخاصة يعتمد على خطتك.
4. أنشئ مستودعًا فارغًا؛ الحزمة تحتوي بالفعل على `README.md` و`.gitignore`.
5. افتح **uploading an existing file** في المستودع الجديد، أو **Add file → Upload files** إن كانت ظاهرة.
6. ارفع **محتويات المجلد بعد فك الضغط**: الملفات والمجلدات الموجودة داخله. يجب أن ترى `README.md` و`package.json` و`dist` مباشرة في جذر المستودع.
7. أظهر الملفات المخفية في مدير الملفات، وتأكد من رفع `.github` و`.gitignore` و`.gitattributes` أيضًا.
8. اكتب رسالة للحفظ، مثل `Add Quran glossary reader`، ثم اختر **Commit changes**.

احتفظ بملف ZIP للتنزيل أو النسخ الاحتياطي. تشغيل المشروع من المستودع يعتمد على وجود محتوياته مفكوكة.

رفع الملفات من المتصفح يقبل ملفات حتى 25 MiB للملف الواحد، وحتى 100 ملف في عملية واحدة؛ ملفات هذه الحزمة ضمن هذه الحدود.

المصدر: [توثيق GitHub لرفع الملفات](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

### إذا لم يظهر مجلد `.github` بعد الرفع

يمكنك إنشاء الملف من GitHub عبر **Add file → Create new file**. اكتب الاسم كاملًا:

```text
.github/workflows/pages.yml
```

ثم انسخ محتوى الملف الموافق من الحزمة، واحفظه على الفرع الافتراضي للمستودع.

## 2. نشر الموقع على GitHub Pages — اختياري

ملف النشر المرفق يعمل عند تشغيله يدويًا من GitHub Actions. بعد رفع المشروع:

1. افتح **Settings → Pages** داخل المستودع.
2. في **Build and deployment → Source** اختر **GitHub Actions**.
3. افتح تبويب **Actions** ثم سير العمل **Deploy to GitHub Pages**.
4. اختر **Run workflow**، وحدد الفرع الافتراضي الذي رفعت إليه الملفات، ثم شغّله.
5. بعد اكتمال التشغيل، افتح الرابط في نتيجة النشر أو في **Settings → Pages**.

ينشر هذا السير محتويات `dist`، بما فيها البيانات والخطوط. لا يحتاج أسرارًا مضافة يدويًا؛ يستخدم صلاحيات GitHub Actions المعلنة في الملف. بعد تعديل ملفات الموقع مستقبلًا، شغّل سير العمل مرة أخرى لتحديث النسخة المنشورة.

إذا لم يظهر سير العمل في تبويب Actions، تحقق من أن `.github/workflows/pages.yml` موجود على الفرع الافتراضي، وأن GitHub Actions مفعّل للمستودع.

المصدر: [توثيق GitHub Pages لسير العمل المخصص](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 3. تجربة الموقع على جهازك

افتح الطرفية داخل مجلد المشروع. على Linux أو macOS:

```bash
python3 -m http.server 8000 --directory dist
```

على Windows، إذا كان Python مثبتًا مع المشغّل `py`:

```powershell
py -m http.server 8000 --directory dist
```

افتح [http://localhost:8000](http://localhost:8000). اترك الطرفية مفتوحة طوال التجربة، واضغط `Ctrl+C` لإيقاف الخادم. تحميل البيانات ووحدات JavaScript يحتاج خادمًا محليًا؛ افتح عنوان الخادم في المتصفح.

## 4. اختبارات التطوير والتحقق من البيانات

التشغيل المعتاد للموقع لا يحتاج أدوات الاختبار. للتحقق قبل تعديل التطبيق أو البيانات، ثبّت Node.js 24 وPython 3.10 أو أحدث. جرى التحقق من الحزمة باستخدام Node.js 24.22.3 وPython 3.12.14 و`fonttools` 4.61.1.

### Linux أو macOS

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
PYTHON="$PWD/.venv/bin/python" npm test
.venv/bin/python scripts/build_glossary_links.py --check
```

### Windows — PowerShell

```powershell
py -m venv .venv
$env:PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
& $env:PYTHON -m pip install -r requirements-dev.txt
npm test
& $env:PYTHON scripts/build_glossary_links.py --check
```

الاختبارات تستخدم أدوات Node.js المدمجة، ولذلك لا تحتاج `npm install`. حزمة `fonttools` تُستخدم لفحص تغطية الخط للحروف. المتغير `PYTHON` يتيح تحديد مفسّر Python المستخدم في الاختبارات.

أمر `--check` يراجع خريطة الشروح الحالية دون تغيير ملفات المصدر. راجع [سجل ربط الكلمات بالشروح](source-data/mushaf/GLOSSARY_ALIGNMENT.md) قبل تغيير طبقة الربط. بيانات المقارنة المستقلة القديمة لإصدار حفص v2 المشار إليها في تقرير المصدر ليست ضمن الحزمة؛ التشغيل والاختبارات المرفقة لا تحتاجها.

## 5. الحقوق والمصادر

اقرأ [LICENSES.md](LICENSES.md) قبل إعادة توزيع المحتوى أو اختيار رخصة لشيفرة التطبيق. يحتفظ كل مصدر بيانات وخط بشروطه وإسناده. الملفات الأصلية محفوظة كما وصلت، بما فيها ملاحظات المصدر الموثقة؛ توجد معالجة الربط في طبقة مستقلة داخل التطبيق.
