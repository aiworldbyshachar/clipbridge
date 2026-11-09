<div dir="rtl">

# ClipBridge

**העתק במק. הדבק בפיסי.** וגם להפך.
סנכרון לוח העתקה בין Mac ל-Windows ברשת הביתית - חינמי, בקוד פתוח, עם היסטוריה משותפת בלתי מוגבלת.

[אתר וסרטון הדגמה](https://aiworldbyshachar.github.io/clipbridge/) · [הורדה ל-Windows](https://github.com/aiworldbyshachar/clipbridge/releases/latest/download/ClipBridge-Windows-Setup.exe) · [הורדה ל-Mac](https://github.com/aiworldbyshachar/clipbridge/releases/latest/download/ClipBridge-macOS.dmg) · [English](README.md)

- **העתק כאן, הדבק שם**: מה שמעתיקים (Ctrl+C / ⌘C) במחשב אחד נמצא תוך רגע בלוח ההעתקה של השני.
- **היסטוריה משותפת ללא הגבלה**: כל העתקה נשמרת בשני המחשבים, עם שם המכשיר שממנו הגיעה. חיפוש, מועדפים, העתקה חוזרת. העתקות שנעשו כשמחשב היה מחוץ לבית מסתנכרנות כשהוא חוזר.
- **טקסט, טקסט מעוצב ותמונות** (גם צילומי מסך).
- **פרטי**: בלי חשבון, בלי שרת, בלי ענן - המחשבים מדברים ישירות ברשת שלך, בהצפנת AES-256-GCM במפתח שנגזר מקוד החיבור. מצב פרטי עוצר הכל בלחיצה.
- **6 שפות**: אנגלית (ברירת מחדל), עברית, ספרדית, צרפתית, רוסית וערבית - עברית וערבית מימין לשמאל.
- **חינם וקוד פתוח** ברישיון MIT.

> **הכלל היחיד:** שני המחשבים חייבים להיות על **אותה רשת מקומית** - אותו Wi-Fi (או אותו ראוטר בכבל).

## התקנה

- **Windows 10/11**: הורד את `ClipBridge-Windows-Setup.exe` והרץ. אם מופיע "Windows protected your PC" - **More info** ← **Run anyway**. כשחומת האש שואלת - **Allow access**, וודא שהרשת הביתית מוגדרת כ-**Private**.
- **macOS 12 ומעלה**: הורד את `ClipBridge-macOS.dmg`, פתח וגרור את ClipBridge ל-Applications. בפתיחה הראשונה, אם macOS לא מצליח לאמת את האפליקציה - הגדרות מערכת ← פרטיות ואבטחה ← **Open Anyway**. אשר גישה לרשת המקומית. אם מופיע שהאפליקציה "פגומה" (damaged), הרץ פעם אחת בטרמינל: `xattr -cr /Applications/ClipBridge.app`

האפליקציות לא חתומות בתעודות מפתחים בתשלום של Apple/Microsoft, ולכן שתי המערכות שואלות פעם אחת.

## חיבור בין המחשבים (פעם אחת)

1. במחשב הראשון: ClipBridge ← **Settings**. תחת **Connect your devices** מופיע קוד, למשל `K7QM-4XRT-P9WE`.
2. במחשב השני: Settings ← **Code from another device** ← הקלד את הקוד ← **Apply**.
3. תוך כמה שניות יופיע למעלה "Connected to …".

רוצה את הממשק בעברית? Settings ← General ← Language ← עברית.

## שימוש

- מעתיקים ומדביקים כרגיל.
- **חלון ההיסטוריה**: לחיצה על האייקון, או `Ctrl+Shift+Space` ב-Windows / `⌘⇧Space` במק. הקלדה מחפשת, חיצים בוחרים, Enter מעתיק, Esc סוגר.
- **השהיה (מצב פרטי)**, **הפעלה עם הכניסה למחשב** ו**שפה** - בהגדרות.

## פתרון בעיות

- **"Looking for devices…" כל הזמן**: אותה רשת (לא רשת אורחים)? האפליקציה פתוחה בשניהם? ב-Windows חומת האש צריכה לאפשר ל-ClipBridge ברשת פרטית; במק - הגדרות מערכת ← פרטיות ואבטחה ← רשת מקומית ← ClipBridge מופעל.
- **ראוטר שחוסם גילוי** (נפוץ ב-Mesh): הוסף את המחשב השני לפי IP בהגדרות. פורטים: TCP 47801, UDP 47800.
- יומן לפתרון בעיות: `clipbridge.log` בתיקיית הנתונים (Settings ← Open data folder).

## בנייה מהקוד

```bash
npm install
npm start
npm test
```

במק: `bash scripts/build-mac.sh` בונה ומתקין ב-Applications. פרטים טכניים מלאים ב-[README באנגלית](README.md).

## עוד כלים חינמיים

- [FolderBridge](https://github.com/aiworldbyshachar/folderbridge): שומרים במק, פותחים בפיסי, עם תיקייה אחת שזהה בשני המחשבים.
- [KeyBridge](https://github.com/aiworldbyshachar/keybridge): לוחצים פעם אחת והטקסט מוקלד. קיצורי מקלדת עם הבחנה בין מקשי ימין ושמאל, בכל מחשב שמתחברים אליו.

</div>
