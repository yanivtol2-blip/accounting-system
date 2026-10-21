# Signiv - חותמים מהנייד: סרטון הסבר עם קריינות

סרטון של 47 שניות שמראה איך חותמים על מסמך מהטלפון, מנקודת המבט של החותמת: SMS, קישור, המסמך נפתח בדפדפן, חתימה באצבע, "אשר וחתום", נחתם ועותק במייל. קריינות נשית בעברית, כיתובים על המסך (נקראים גם בלי סאונד) ומוזיקת רקע שקטה מתחת לקול. התסריט ולוח הסצנות שאושרו: `concept.md`.

## הקבצים הסופיים
| קובץ | מה |
|---|---|
| `signiv-mobile-signing-vertical-voice.mp4` | אנכי 1080x1920, עם קריינות ומוזיקה (ריל, סטורי, וואטסאפ) |
| `signiv-mobile-signing-landscape-voice.mp4` | רוחבי 1920x1080, עם קריינות ומוזיקה (אתר, יוטיוב, שליחה ללקוחות) |
| `signiv-mobile-signing-vertical.mp4`, `signiv-mobile-signing-landscape.mp4` | אותו סרטון בלי סאונד, לעריכה או למוזיקה אחרת |
| `cover-vertical.jpg`, `cover-landscape.jpg` | תמונת שער: האצבע על "אשר וחתום", אחרי החתימה (0:28.6 בסרטון) |
| `sheet-vertical.jpg`, `sheet-landscape.jpg`, `frames/` | לוח הסצנות שאושר |

## הקריינות
- **קול:** Sarah של ElevenLabs (קול מובנה, נשי), מודל `eleven_v4`, עברית, מהירות 1.1. קולות עבריים "אמיתיים" מהספרייה שלהם (יעל, תמר, נועה) נחסמים בחשבון החינמי; בחשבון בתשלום אפשר להחליף ב-`--voice`.
- **הנוסח:** `narration.json`, שורה לכל סצנה, עם החלון שלה בסיפור.
- **תזמון:** `_tools/vo-timing.js` מודד כמה זמן כל משפט באמת נמשך ומאריך את הסצנה שלו בדיוק במה שצריך (כאן 2.3 שניות בסך הכול, בעיקר בגלילת המסמך), ומשאיר 0.4 שניות נשימה אחרי כל משפט. התוצאה ב-`timing.js`, והדף מנגן את הסיפור לפיו.
- **בדיקה:** תמלול אוטומטי של המיקס הסופי (Whisper בעברית) החזיר את הנוסח מילה במילה. במשפט השני "לכם" נשמע בהקלטה הראשונה כמו "לכן", ולכן המילה מנוקדת (לָכֶם) ב-`narration.json`, ובמיקס הסופי היא נשמעת נכון. את השם התמלול כתב "סגניב", כך שגם את ההגייה של "סיגניב" כדאי לבדוק באוזן. אוזן אנושית עוד לא שמעה את הסרטון; את המבטא ואת הטון צריך לאשר בהאזנה.

| זמן בסרטון | קריינות |
|---|---|
| 0:00 | ככה חותמים על מסמך, ישר מהנייד. |
| 0:03 | העסק מעלה את המסמך, ושולח לכם קישור לחתימה ב-SMS. |
| 0:09 | מגיעה הודעה. לוחצים על הקישור. |
| 0:13 | המסמך נפתח מיד בדפדפן, בלי להוריד שום אפליקציה. גוללים וקוראים בנחת. |
| 0:20 | בסוף המסמך מחכה שדה חתימה. חותמים עם האצבע, בדיוק כמו על נייר. |
| 0:27 | לוחצים על אשר וחתום. |
| 0:30 | וזהו. המסמך נחתם, ועותק חתום נשלח אליכם במייל. |
| 0:37 | פחות מדקה, מכל מקום. |
| 0:43 | סיגניב. חותמים מהנייד, בפשטות. |

## המוזיקה
"Motivating Mornings" של Mixkit (`https://assets.mixkit.co/music/759/759.mp3`), ברישיון Mixkit Free License: מותר בסרטון מסחרי, אסור להפיץ את הקובץ עצמו, ולכן הוא לא ב-git ו-`mix.sh` מוריד אותו. מתחת לקול ב-31- LUFS, נחלשת עוד קצת בזמן הדיבור, נכנסת ויוצאת בהדרגה.

**עוצמה סופית:** 14.3- LUFS, שיא 2.3- dBFS (מתאים לרשתות החברתיות).

## איך מפיקים שוב (מתוך `store/videos/_tools`)
```bash
npm ci
export ELEVENLABS_API_KEY=...        # בכספת של הפרויקט: ELEVENLABS_API_KEY
node tts.js --lines ../signiv-mobile-signing/narration.json --voice EXAVITQu4vr4xnSDxMaL --model eleven_v4 --speed 1.1
node tts.js --lines ../signiv-mobile-signing/narration.json --voice EXAVITQu4vr4xnSDxMaL --model eleven_v4 --speed 1.1 --only 2   # הקלטה חוזרת של שורה אחת
node vo-timing.js --lines ../signiv-mobile-signing/narration.json --breath 400
node render.js --page ../signiv-mobile-signing/signiv-mobile-signing.html --size 1080x1920 --fps 30 --o ../signiv-mobile-signing/signiv-mobile-signing-vertical.mp4
node render.js --page ../signiv-mobile-signing/signiv-mobile-signing.html --size 1920x1080 --fps 30 --o ../signiv-mobile-signing/signiv-mobile-signing-landscape.mp4
bash ../signiv-mobile-signing/mix.sh
```
שינוי בנוסח: עורכים את `narration.json` (וגם את הכיתוב המתאים ב-HTML), ומריצים מחדש את כל השורות שלמעלה. הקלטה חדשה מחליפה את התזמון, ולכן תמיד מרנדרים מחדש אחרי `vo-timing.js`.
