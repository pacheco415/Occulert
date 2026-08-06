// Occulert Language System
// Supported languages: en, es, fr, pt, de, ar, zh, ja
(function(){
    const translations = {
          en: {
                  nav_features: "Features",
                  nav_how: "How It Works",
                  nav_install: "Install",
                  nav_about: "About",
                  nav_faq: "FAQ",
                  nav_hub: "Product Hub",
                  nav_launch: "Launch App",
                  lang_label: "Language",
                  hero_badge: "AI Drowsiness Detection",
                  hero_h1a: "Stay Alert.",
                  hero_h1b: "Arrive Safe.",
                  hero_desc: "Occulert uses on-device AI to monitor your eyes and detect fatigue in real time. No special hardware needed — just your phone camera.",
                  hero_btn1: "Launch Driver App",
                  hero_btn2: "See How It Works",
                  trust1: "No account required",
                  trust2: "Runs on your device",
                  trust3: "No data sold",
                  disclaimer_title: "Safety Disclaimer",
                  disclaimer_text: "Occulert is a supplemental prototype alerting tool only. It does not replace attentive driving, adequate rest, emergency services, medical judgment, fleet safety programs, or compliance with traffic laws. Never drive tired.",
                  stats_label1: "Crashes involve driver fatigue",
                  stats_label2: "Fatigue-related crashes per year in the US",
                  stats_label3: "Of drowsy drivers don't realize they're impaired",
                  stats_label4: "No subscription, no hardware required",
                  mockup_note: "Illustrative interface. Values shown are examples, not measured results.",
                  footer_privacy: "Privacy Policy",
                  footer_safety: "Safety & Liability",
                  footer_rights: "© 2026 Occulert. All rights reserved.",
                  cookie_accept: "Accept",
                  cookie_decline: "Decline",
                  cookie_msg: "We use minimal analytics to improve the experience. No camera data is ever shared.",
          },
          es: {
                  nav_features: "Características",
                  nav_how: "Cómo Funciona",
                  nav_install: "Instalar",
                  nav_about: "Acerca de",
                  nav_faq: "Preguntas",
                  nav_hub: "Centro de Producto",
                  nav_launch: "Abrir App",
                  lang_label: "Idioma",
                  hero_badge: "Detección de Somnolencia IA",
                  hero_h1a: "Mantente Alerta.",
                  hero_h1b: "Llega Seguro.",
                  hero_desc: "Occulert usa IA en el dispositivo para monitorear tus ojos y detectar fatiga en tiempo real. No necesitas hardware especial — solo la cámara de tu teléfono.",
                  hero_btn1: "Abrir App de Conductor",
                  hero_btn2: "Ver Cómo Funciona",
                  trust1: "Sin cuenta requerida",
                  trust2: "Se ejecuta en tu dispositivo",
                  trust3: "Sin venta de datos",
                  disclaimer_title: "Aviso de Seguridad",
                  disclaimer_text: "Occulert es una herramienta de alerta complementaria. No reemplaza la conducción atenta, el descanso adecuado o el cumplimiento de las leyes de tráfico.",
                  stats_label1: "Los accidentes involucran fatiga del conductor",
                  stats_label2: "Accidentes por fatiga al año en EE.UU.",
                  stats_label3: "Los conductores somnolientos no saben que están deteriorados",
                  stats_label4: "Sin suscripción, sin hardware",
                  mockup_note: "Interfaz ilustrativa. Los valores mostrados son ejemplos, no resultados medidos.",
                  footer_privacy: "Privacidad",
                  footer_safety: "Seguridad y Responsabilidad",
                  footer_rights: "© 2026 Occulert. Todos los derechos reservados.",
                  cookie_accept: "Aceptar",
                  cookie_decline: "Rechazar",
                  cookie_msg: "Usamos análisis mínimos para mejorar la experiencia. Los datos de cámara nunca se comparten.",
          },
          fr: {
                  nav_features: "Fonctionnalités",
                  nav_how: "Comment ça marche",
                  nav_install: "Installer",
                  nav_about: "À propos",
                  nav_faq: "FAQ",
                  nav_hub: "Hub Produit",
                  nav_launch: "Lancer l'App",
                  lang_label: "Langue",
                  hero_badge: "Détection de Somnolence IA",
                  hero_h1a: "Restez Éveillé.",
                  hero_h1b: "Arrivez en Sécurité.",
                  hero_desc: "Occulert utilise l'IA embarquée pour surveiller vos yeux et détecter la fatigue en temps réel. Aucun matériel spécial — juste la caméra de votre téléphone.",
                  hero_btn1: "Lancer l'App Conducteur",
                  hero_btn2: "Voir Comment ça Marche",
                  trust1: "Aucun compte requis",
                  trust2: "Fonctionne sur votre appareil",
                  trust3: "Données non vendues",
                  disclaimer_title: "Avertissement de Sécurité",
                  disclaimer_text: "Occulert est un outil d'alerte complémentaire. Il ne remplace pas une conduite attentive, un repos suffisant ou le respect du code de la route.",
                  stats_label1: "Les accidents impliquent la fatigue du conducteur",
                  stats_label2: "Accidents liés à la fatigue par an aux États-Unis",
                  stats_label3: "Les conducteurs somnolents ignorent leur état",
                  stats_label4: "Sans abonnement, sans matériel",
                  mockup_note: "Interface illustrative. Les valeurs affichées sont des exemples, pas des résultats mesurés.",
                  footer_privacy: "Confidentialité",
                  footer_safety: "Sécurité et Responsabilité",
                  footer_rights: "© 2026 Occulert. Tous droits réservés.",
                  cookie_accept: "Accepter",
                  cookie_decline: "Refuser",
                  cookie_msg: "Nous utilisons une analyse minimale pour améliorer l'expérience. Aucune donnée caméra n'est partagée.",
          },
          pt: {
                  nav_features: "Recursos",
                  nav_how: "Como Funciona",
                  nav_install: "Instalar",
                  nav_about: "Sobre",
                  nav_faq: "Perguntas",
                  nav_hub: "Hub do Produto",
                  nav_launch: "Abrir App",
                  lang_label: "Idioma",
                  hero_badge: "Detecção de Sonolência IA",
                  hero_h1a: "Fique Alerta.",
                  hero_h1b: "Chegue com Segurança.",
                  hero_desc: "Occulert usa IA no dispositivo para monitorar seus olhos e detectar fadiga em tempo real. Sem hardware especial — apenas a câmera do seu telefone.",
                  hero_btn1: "Abrir App do Motorista",
                  hero_btn2: "Ver Como Funciona",
                  trust1: "Sem conta necessária",
                  trust2: "Roda no seu dispositivo",
                  trust3: "Dados não vendidos",
                  disclaimer_title: "Aviso de Segurança",
                  disclaimer_text: "Occulert é uma ferramenta de alerta complementar. Não substitui direção atenta, descanso adequado ou conformidade com as leis de trânsito.",
                  stats_label1: "Acidentes envolvem fadiga do motorista",
                  stats_label2: "Acidentes por fadiga por ano nos EUA",
                  stats_label3: "Motoristas sonolentos não percebem o risco",
                  stats_label4: "Sem assinatura, sem hardware",
                  mockup_note: "Interface ilustrativa. Os valores mostrados são exemplos, não resultados medidos.",
                  footer_privacy: "Privacidade",
                  footer_safety: "Segurança e Responsabilidade",
                  footer_rights: "© 2026 Occulert. Todos os direitos reservados.",
                  cookie_accept: "Aceitar",
                  cookie_decline: "Recusar",
                  cookie_msg: "Usamos análises mínimas para melhorar a experiência. Nenhum dado de câmera é compartilhado.",
          },
          de: {
                  nav_features: "Funktionen",
                  nav_how: "So funktioniert's",
                  nav_install: "Installieren",
                  nav_about: "Über uns",
                  nav_faq: "FAQ",
                  nav_hub: "Produkt-Hub",
                  nav_launch: "App starten",
                  lang_label: "Sprache",
                  hero_badge: "KI-Müdigkeitserkennung",
                  hero_h1a: "Bleiben Sie wach.",
                  hero_h1b: "Kommen Sie sicher an.",
                  hero_desc: "Occulert nutzt KI auf dem Gerät, um Ihre Augen zu überwachen und Müdigkeit in Echtzeit zu erkennen. Keine spezielle Hardware — nur Ihre Handykamera.",
                  hero_btn1: "Fahrer-App starten",
                  hero_btn2: "So funktioniert's",
                  trust1: "Kein Konto erforderlich",
                  trust2: "Läuft auf Ihrem Gerät",
                  trust3: "Keine Daten verkauft",
                  disclaimer_title: "Sicherheitshinweis",
                  disclaimer_text: "Occulert ist ein ergänzendes Warnsystem. Es ersetzt keine aufmerksame Fahrweise, ausreichende Ruhe oder die Einhaltung der Verkehrsregeln.",
                  stats_label1: "Unfälle durch Fahrermüdigkeit",
                  stats_label2: "Müdigkeitsunfälle pro Jahr in den USA",
                  stats_label3: "Schläfrige Fahrer bemerken ihre Beeinträchtigung nicht",
                  stats_label4: "Kein Abonnement, keine Hardware",
                  mockup_note: "Illustrative Oberfläche. Die gezeigten Werte sind Beispiele, keine gemessenen Ergebnisse.",
                  footer_privacy: "Datenschutz",
                  footer_safety: "Sicherheit & Haftung",
                  footer_rights: "© 2026 Occulert. Alle Rechte vorbehalten.",
                  cookie_accept: "Akzeptieren",
                  cookie_decline: "Ablehnen",
                  cookie_msg: "Wir verwenden minimale Analysen zur Verbesserung der Erfahrung. Keine Kameradaten werden geteilt.",
          },
          ar: {
                  nav_features: "الميزات",
                  nav_how: "كيف يعمل",
                  nav_install: "تثبيت",
                  nav_about: "حول",
                  nav_faq: "الأسئلة الشائعة",
                  nav_hub: "مركز المنتج",
                  nav_launch: "تشغيل التطبيق",
                  lang_label: "اللغة",
                  hero_badge: "كشف النعاس بالذكاء الاصطناعي",
                  hero_h1a: "ابق يقظاً.",
                  hero_h1b: "وصل بأمان.",
                  hero_desc: "يستخدم Occulert الذكاء الاصطناعي على الجهاز لمراقبة عينيك وكشف التعب في الوقت الفعلي. لا حاجة لأجهزة خاصة — فقط كاميرا هاتفك.",
                  hero_btn1: "تشغيل تطبيق السائق",
                  hero_btn2: "شاهد كيف يعمل",
                  trust1: "لا حاجة لحساب",
                  trust2: "يعمل على جهازك",
                  trust3: "لا تُباع البيانات",
                  disclaimer_title: "تنبيه السلامة",
                  disclaimer_text: "Occulert أداة تنبيه تكميلية. لا تحل محل القيادة المنتبهة أو الراحة الكافية أو الامتثال لقوانين المرور.",
                  stats_label1: "الحوادث تنطوي على تعب السائق",
                  stats_label2: "حوادث مرتبطة بالتعب سنوياً في الولايات المتحدة",
                  stats_label3: "السائقون النعساء لا يدركون ضعفهم",
                  stats_label4: "بدون اشتراك، بدون أجهزة",
                  mockup_note: "واجهة توضيحية. القيم المعروضة أمثلة وليست نتائج مقاسة.",
                  footer_privacy: "سياسة الخصوصية",
                  footer_safety: "السلامة والمسؤولية",
                  footer_rights: "© 2026 Occulert. جميع الحقوق محفوظة.",
                  cookie_accept: "قبول",
                  cookie_decline: "رفض",
                  cookie_msg: "نستخدم تحليلات بسيطة لتحسين التجربة. لا تتم مشاركة بيانات الكاميرا أبداً.",
          },
          zh: {
                  nav_features: "功能",
                  nav_how: "工作原理",
                  nav_install: "安装",
                  nav_about: "关于",
                  nav_faq: "常见问题",
                  nav_hub: "产品中心",
                  nav_launch: "启动应用",
                  lang_label: "语言",
                  hero_badge: "AI疲劳检测",
                  hero_h1a: "保持警觉。",
                  hero_h1b: "安全到达。",
                  hero_desc: "Occulert 使用设备端 AI 实时监测您的眼睛并检测疲劳。无需特殊硬件——只需您的手机摄像头。",
                  hero_btn1: "启动驾驶员应用",
                  hero_btn2: "了解工作原理",
                  trust1: "无需账户",
                  trust2: "在您的设备上运行",
                  trust3: "数据不出售",
                  disclaimer_title: "安全声明",
                  disclaimer_text: "Occulert 是一种辅助警报工具。它不能替代专注驾驶、充足休息或遵守交通法规。",
                  stats_label1: "事故涉及驾驶员疲劳",
                  stats_label2: "美国每年疲劳相关事故",
                  stats_label3: "困倦驾驶员不意识到自己受损",
                  stats_label4: "无订阅，无硬件",
                  mockup_note: "示意界面。所示数值为示例，并非实测结果。",
                  footer_privacy: "隐私政策",
                  footer_safety: "安全与责任",
                  footer_rights: "© 2026 Occulert. 版权所有 2026年。",
                  cookie_accept: "接受",
                  cookie_decline: "拒绝",
                  cookie_msg: "我们使用最小分析来改善体验。摄像头数据从不共享。",
          },
          ja: {
                  nav_features: "機能",
                  nav_how: "仕組み",
                  nav_install: "インストール",
                  nav_about: "概要",
                  nav_faq: "よくある質問",
                  nav_hub: "製品ハブ",
                  nav_launch: "アプリを起動",
                  lang_label: "言語",
                  hero_badge: "AI眠気検出",
                  hero_h1a: "注意を保って。",
                  hero_h1b: "安全に到着。",
                  hero_desc: "Occulertはデバイス上のAIを使用して目をリアルタイムで監視し、疲労を検出します。特別なハードウェアは不要です——スマホのカメラだけです。",
                  hero_btn1: "ドライバーアプリを起動",
                  hero_btn2: "仕組みを見る",
                  trust1: "アカウント不要",
                  trust2: "デバイスで動作",
                  trust3: "データ販売なし",
                  disclaimer_title: "安全に関する注意事項",
                  disclaimer_text: "Occulertは補助的な警告ツールです。注意深い運転、十分な休息、または交通法規の遵守に代わるものではありません。",
                  stats_label1: "事故はドライバーの疲労を伴う",
                  stats_label2: "米国での年間疲労関連事故",
                  stats_label3: "眠い運転手は障害に気づかない",
                  stats_label4: "サブスクリプション不要、ハードウェア不要",
                  mockup_note: "イメージ画面です。表示されている値は例であり、実測結果ではありません。",
                  footer_privacy: "プライバシーポリシー",
                  footer_safety: "安全と責任",
                  footer_rights: "© 2026 Occulert. 全著作権所有。",
                  cookie_accept: "同意する",
                  cookie_decline: "断る",
                  cookie_msg: "経験改善のために最小限の分析を使用します。カメラデータは共有されません。",
          }
    };

   const RTL_LANGS = ['ar'];
    const LANG_NAMES = {
          en: 'English', es: 'Español', fr: 'Français', pt: 'Português',
          de: 'Deutsch', ar: 'العربية', zh: '中文', ja: '日本語'
    };

   const commonTextTranslations = {
         "Home": { es: "Inicio", fr: "Accueil", pt: "Início", de: "Startseite", ar: "الرئيسية", zh: "首页", ja: "ホーム" },
         "Driver App": { es: "App de Conductor", fr: "App Conducteur", pt: "App do Motorista", de: "Fahrer-App", ar: "تطبيق السائق", zh: "驾驶员应用", ja: "ドライバーアプリ" },
         "Fleet Dashboard": { es: "Panel de Flota", fr: "Tableau de Flotte", pt: "Painel da Frota", de: "Flotten-Dashboard", ar: "لوحة الأسطول", zh: "车队仪表板", ja: "フリートダッシュボード" },
         "Session History": { es: "Historial de Sesiones", fr: "Historique des Sessions", pt: "Histórico de Sessões", de: "Sitzungsverlauf", ar: "سجل الجلسات", zh: "会话历史", ja: "セッション履歴" },
         "History": { es: "Historial", fr: "Historique", pt: "Histórico", de: "Verlauf", ar: "السجل", zh: "历史", ja: "履歴" },
         "Account Settings": { es: "Configuración de Cuenta", fr: "Paramètres du Compte", pt: "Configurações da Conta", de: "Kontoeinstellungen", ar: "إعدادات الحساب", zh: "账户设置", ja: "アカウント設定" },
         "Privacy": { es: "Privacidad", fr: "Confidentialité", pt: "Privacidade", de: "Datenschutz", ar: "الخصوصية", zh: "隐私", ja: "プライバシー" },
         "Privacy Policy": { es: "Política de Privacidad", fr: "Politique de Confidentialité", pt: "Política de Privacidade", de: "Datenschutzerklärung", ar: "سياسة الخصوصية", zh: "隐私政策", ja: "プライバシーポリシー" },
         "Safety": { es: "Seguridad", fr: "Sécurité", pt: "Segurança", de: "Sicherheit", ar: "السلامة", zh: "安全", ja: "安全" },
         "Safety Info": { es: "Información de Seguridad", fr: "Infos Sécurité", pt: "Informações de Segurança", de: "Sicherheitsinfo", ar: "معلومات السلامة", zh: "安全信息", ja: "安全情報" },
         "Contact": { es: "Contacto", fr: "Contact", pt: "Contato", de: "Kontakt", ar: "اتصال", zh: "联系", ja: "連絡先" },
         "Pilot Program": { es: "Programa Piloto", fr: "Programme Pilote", pt: "Programa Piloto", de: "Pilotprogramm", ar: "برنامج تجريبي", zh: "试点计划", ja: "パイロットプログラム" },
         "Join the Pilot Program": { es: "Unirse al Programa Piloto", fr: "Rejoindre le Programme Pilote", pt: "Entrar no Programa Piloto", de: "Am Pilotprogramm teilnehmen", ar: "انضم إلى البرنامج التجريبي", zh: "加入试点计划", ja: "パイロットプログラムに参加" },
         "View Product Hub": { es: "Ver Centro de Producto", fr: "Voir le Hub Produit", pt: "Ver Hub do Produto", de: "Produkt-Hub ansehen", ar: "عرض مركز المنتج", zh: "查看产品中心", ja: "製品ハブを見る" },
         "Theme": { es: "Tema", fr: "Thème", pt: "Tema", de: "Design", ar: "المظهر", zh: "主题", ja: "テーマ" },
         "Dark Mode": { es: "Modo Oscuro", fr: "Mode Sombre", pt: "Modo Escuro", de: "Dunkelmodus", ar: "الوضع الداكن", zh: "深色模式", ja: "ダークモード" },
         "Light Mode": { es: "Modo Claro", fr: "Mode Clair", pt: "Modo Claro", de: "Hellmodus", ar: "الوضع الفاتح", zh: "浅色模式", ja: "ライトモード" },
         "☀️ Light Mode": { es: "☀️ Modo Claro", fr: "☀️ Mode Clair", pt: "☀️ Modo Claro", de: "☀️ Hellmodus", ar: "☀️ الوضع الفاتح", zh: "☀️ 浅色模式", ja: "☀️ ライトモード" },
         "🌙 Dark Mode": { es: "🌙 Modo Oscuro", fr: "🌙 Mode Sombre", pt: "🌙 Modo Escuro", de: "🌙 Dunkelmodus", ar: "🌙 الوضع الداكن", zh: "🌙 深色模式", ja: "🌙 ダークモード" },
         "Toggle theme": { es: "Cambiar tema", fr: "Changer le thème", pt: "Alternar tema", de: "Design wechseln", ar: "تبديل المظهر", zh: "切换主题", ja: "テーマを切り替え" },
         "Open menu": { es: "Abrir menú", fr: "Ouvrir le menu", pt: "Abrir menu", de: "Menü öffnen", ar: "فتح القائمة", zh: "打开菜单", ja: "メニューを開く" },
         "Back to top": { es: "Volver arriba", fr: "Retour en haut", pt: "Voltar ao topo", de: "Nach oben", ar: "العودة للأعلى", zh: "返回顶部", ja: "トップへ戻る" },
         "Select language": { es: "Seleccionar idioma", fr: "Choisir la langue", pt: "Selecionar idioma", de: "Sprache auswählen", ar: "اختر اللغة", zh: "选择语言", ja: "言語を選択" },
         "Occulert home": { es: "Inicio de Occulert", fr: "Accueil Occulert", pt: "Início do Occulert", de: "Occulert Startseite", ar: "صفحة Occulert الرئيسية", zh: "Occulert 首页", ja: "Occulert ホーム" },
         "AI-powered drowsiness detection for drivers. Built to make roads safer for everyone.": { es: "Detección de somnolencia con IA para conductores. Creada para hacer las carreteras más seguras para todos.", fr: "Détection de somnolence par IA pour les conducteurs. Conçu pour rendre les routes plus sûres pour tous.", pt: "Detecção de sonolência por IA para motoristas. Criado para tornar as estradas mais seguras para todos.", de: "KI-gestützte Müdigkeitserkennung für Fahrer. Entwickelt, um Straßen für alle sicherer zu machen.", ar: "كشف النعاس بالذكاء الاصطناعي للسائقين. مصمم لجعل الطرق أكثر أماناً للجميع.", zh: "面向驾驶员的 AI 疲劳检测。旨在让道路对每个人都更安全。", ja: "ドライバー向けのAI眠気検出。すべての人にとって道路をより安全にするために作られました。" },
         "Prototype — not a substitute for rest or safe driving practices": { es: "Prototipo — no sustituye el descanso ni las prácticas de conducción segura", fr: "Prototype — ne remplace pas le repos ni les pratiques de conduite sûres", pt: "Protótipo — não substitui descanso nem práticas de direção segura", de: "Prototyp — kein Ersatz für Ruhe oder sicheres Fahren", ar: "نموذج أولي — ليس بديلاً عن الراحة أو ممارسات القيادة الآمنة", zh: "原型产品 — 不能替代休息或安全驾驶习惯", ja: "プロトタイプ — 休息や安全運転の代わりにはなりません" },
         "No video ever leaves your device": { es: "Ningún video sale de tu dispositivo", fr: "Aucune vidéo ne quitte votre appareil", pt: "Nenhum vídeo sai do seu dispositivo", de: "Kein Video verlässt Ihr Gerät", ar: "لا يغادر أي فيديو جهازك أبداً", zh: "视频永远不会离开您的设备", ja: "動画がデバイス外へ送信されることはありません" },
         "Built for Every Driver": { es: "Creado para Todo Conductor", fr: "Conçu pour Chaque Conducteur", pt: "Criado para Todo Motorista", de: "Für jeden Fahrer entwickelt", ar: "مصمم لكل سائق", zh: "为每位驾驶员打造", ja: "すべてのドライバーのために" },
         "Whether you drive for a living or just get behind the wheel when tired, Occulert™ has your back.": { es: "Ya sea que conduzcas por trabajo o solo manejes cuando estás cansado, Occulert™ te respalda.", fr: "Que vous conduisiez pour gagner votre vie ou simplement lorsque vous êtes fatigué, Occulert™ vous accompagne.", pt: "Se você dirige profissionalmente ou apenas pega o volante quando está cansado, o Occulert™ está com você.", de: "Ob Sie beruflich fahren oder nur müde am Steuer sitzen, Occulert™ unterstützt Sie.", ar: "سواء كنت تقود لكسب رزقك أو تقود وأنت متعب، فإن Occulert™ يدعمك.", zh: "无论您以驾驶为生，还是疲劳时才开车，Occulert™ 都会支持您。", ja: "仕事で運転する場合でも、疲れている時に運転する場合でも、Occulert™ が支えます。" },
         "Real-Time Eye Tracking": { es: "Seguimiento Ocular en Tiempo Real", fr: "Suivi Oculaire en Temps Réel", pt: "Rastreamento Ocular em Tempo Real", de: "Echtzeit-Augentracking", ar: "تتبع العين في الوقت الفعلي", zh: "实时眼动追踪", ja: "リアルタイム視線追跡" },
         "On-Device AI": { es: "IA en el Dispositivo", fr: "IA sur l'Appareil", pt: "IA no Dispositivo", de: "KI auf dem Gerät", ar: "ذكاء اصطناعي على الجهاز", zh: "设备端 AI", ja: "オンデバイスAI" },
         "Escalating Alerts": { es: "Alertas Escalonadas", fr: "Alertes Progressives", pt: "Alertas Escalonados", de: "Eskalierende Warnungen", ar: "تنبيهات متصاعدة", zh: "升级警报", ja: "段階的アラート" },
         "Session Reports": { es: "Informes de Sesión", fr: "Rapports de Session", pt: "Relatórios de Sessão", de: "Sitzungsberichte", ar: "تقارير الجلسة", zh: "会话报告", ja: "セッションレポート" },
         "Fleet Ready": { es: "Listo para Flotas", fr: "Prêt pour les Flottes", pt: "Pronto para Frotas", de: "Flottenbereit", ar: "جاهز للأساطيل", zh: "适用于车队", ja: "フリート対応" },
         "Privacy First": { es: "Privacidad Primero", fr: "Confidentialité d'Abord", pt: "Privacidade em Primeiro Lugar", de: "Datenschutz zuerst", ar: "الخصوصية أولاً", zh: "隐私优先", ja: "プライバシー第一" },
         "Why Occulert Exists": { es: "Por Qué Existe Occulert", fr: "Pourquoi Occulert Existe", pt: "Por Que o Occulert Existe", de: "Warum es Occulert gibt", ar: "لماذا يوجد Occulert", zh: "Occulert 存在的原因", ja: "Occulertが存在する理由" },
         "Connect professionally": { es: "Conectar profesionalmente", fr: "Se connecter professionnellement", pt: "Conectar profissionalmente", de: "Beruflich vernetzen", ar: "تواصل مهنياً", zh: "专业联系", ja: "仕事でつながる" },
         "Join the beta": { es: "Únete a la beta", fr: "Rejoindre la bêta", pt: "Entrar no beta", de: "Beta beitreten", ar: "انضم إلى النسخة التجريبية", zh: "加入测试版", ja: "ベータに参加" },
         "Does Occulert record video?": { es: "¿Occulert graba video?", fr: "Occulert enregistre-t-il la vidéo ?", pt: "O Occulert grava vídeo?", de: "Zeichnet Occulert Videos auf?", ar: "هل يسجل Occulert الفيديو؟", zh: "Occulert 会录制视频吗？", ja: "Occulertは動画を録画しますか？" },
         "Is it free to use?": { es: "¿Es gratis?", fr: "Est-ce gratuit ?", pt: "É gratuito?", de: "Ist die Nutzung kostenlos?", ar: "هل الاستخدام مجاني؟", zh: "可以免费使用吗？", ja: "無料で使えますか？" },
         "What devices does it work on?": { es: "¿En qué dispositivos funciona?", fr: "Sur quels appareils cela fonctionne-t-il ?", pt: "Em quais dispositivos funciona?", de: "Auf welchen Geräten funktioniert es?", ar: "على أي أجهزة يعمل؟", zh: "它支持哪些设备？", ja: "どのデバイスで動作しますか？" },
         "How accurate is the drowsiness detection?": { es: "¿Qué tan precisa es la detección de somnolencia?", fr: "Quelle est la précision de la détection de somnolence ?", pt: "Qual é a precisão da detecção de sonolência?", de: "Wie genau ist die Müdigkeitserkennung?", ar: "ما مدى دقة كشف النعاس؟", zh: "疲劳检测有多准确？", ja: "眠気検出の精度はどれくらいですか？" },
         "Does it work without internet?": { es: "¿Funciona sin internet?", fr: "Fonctionne-t-il sans Internet ?", pt: "Funciona sem internet?", de: "Funktioniert es ohne Internet?", ar: "هل يعمل بدون إنترنت؟", zh: "没有互联网也能工作吗？", ja: "インターネットなしで動作しますか？" },
         "Is my location data shared?": { es: "¿Se comparten mis datos de ubicación?", fr: "Mes données de localisation sont-elles partagées ?", pt: "Meus dados de localização são compartilhados?", de: "Werden meine Standortdaten geteilt?", ar: "هل تتم مشاركة بيانات موقعي؟", zh: "我的位置数据会被共享吗？", ja: "位置情報は共有されますか？" },
         "AI Fatigue Monitoring": { es: "Monitoreo de Fatiga con IA", fr: "Surveillance de Fatigue IA", pt: "Monitoramento de Fadiga por IA", de: "KI-Müdigkeitsüberwachung", ar: "مراقبة التعب بالذكاء الاصطناعي", zh: "AI 疲劳监测", ja: "AI疲労モニタリング" },
         "DROWSY ALERT": { es: "ALERTA DE SOMNOLENCIA", fr: "ALERTE SOMNOLENCE", pt: "ALERTA DE SONOLÊNCIA", de: "MÜDIGKEITSWARNUNG", ar: "تنبيه النعاس", zh: "疲劳警报", ja: "眠気アラート" },
         "Pull over safely": { es: "Detente con seguridad", fr: "Arrêtez-vous en sécurité", pt: "Pare com segurança", de: "Sicher anhalten", ar: "توقف بأمان", zh: "安全靠边停车", ja: "安全に停車してください" },
         "START MONITORING": { es: "INICIAR MONITOREO", fr: "DÉMARRER LA SURVEILLANCE", pt: "INICIAR MONITORAMENTO", de: "ÜBERWACHUNG STARTEN", ar: "بدء المراقبة", zh: "开始监测", ja: "モニタリング開始" },
         "STOP MONITORING": { es: "DETENER MONITOREO", fr: "ARRÊTER LA SURVEILLANCE", pt: "PARAR MONITORAMENTO", de: "ÜBERWACHUNG STOPPEN", ar: "إيقاف المراقبة", zh: "停止监测", ja: "モニタリング停止" },
         "Driving Status": { es: "Estado de Conducción", fr: "État de Conduite", pt: "Status de Condução", de: "Fahrstatus", ar: "حالة القيادة", zh: "驾驶状态", ja: "運転状態" },
         "Safety Notice": { es: "Aviso de Seguridad", fr: "Avis de Sécurité", pt: "Aviso de Segurança", de: "Sicherheitshinweis", ar: "إشعار السلامة", zh: "安全提示", ja: "安全通知" },
         "Privacy Controls": { es: "Controles de Privacidad", fr: "Contrôles de Confidentialité", pt: "Controles de Privacidade", de: "Datenschutzeinstellungen", ar: "عناصر التحكم في الخصوصية", zh: "隐私控制", ja: "プライバシー設定" },
         "Calibration": { es: "Calibración", fr: "Calibration", pt: "Calibração", de: "Kalibrierung", ar: "المعايرة", zh: "校准", ja: "キャリブレーション" },
         "Risk State": { es: "Estado de Riesgo", fr: "État du Risque", pt: "Estado de Risco", de: "Risikostatus", ar: "حالة المخاطر", zh: "风险状态", ja: "リスク状態" },
         "Developer Tools": { es: "Herramientas de Desarrollador", fr: "Outils Développeur", pt: "Ferramentas de Desenvolvedor", de: "Entwicklertools", ar: "أدوات المطور", zh: "开发者工具", ja: "開発者ツール" },
         "Simulate Drowsy Alert": { es: "Simular Alerta de Somnolencia", fr: "Simuler une Alerte Somnolence", pt: "Simular Alerta de Sonolência", de: "Müdigkeitswarnung simulieren", ar: "محاكاة تنبيه النعاس", zh: "模拟疲劳警报", ja: "眠気アラートをシミュレート" },
         "Reset Session Data": { es: "Restablecer Datos de Sesión", fr: "Réinitialiser les Données de Session", pt: "Redefinir Dados da Sessão", de: "Sitzungsdaten zurücksetzen", ar: "إعادة تعيين بيانات الجلسة", zh: "重置会话数据", ja: "セッションデータをリセット" },
         "Fleet Overview": { es: "Resumen de Flota", fr: "Vue d'Ensemble de la Flotte", pt: "Visão Geral da Frota", de: "Flottenübersicht", ar: "نظرة عامة على الأسطول", zh: "车队概览", ja: "フリート概要" },
         "Action Queue": { es: "Cola de Acciones", fr: "File d'Actions", pt: "Fila de Ações", de: "Aktionsliste", ar: "قائمة الإجراءات", zh: "操作队列", ja: "対応キュー" },
         "Refresh": { es: "Actualizar", fr: "Actualiser", pt: "Atualizar", de: "Aktualisieren", ar: "تحديث", zh: "刷新", ja: "更新" },
         "Add Test Lead": { es: "Agregar Lead de Prueba", fr: "Ajouter un Prospect Test", pt: "Adicionar Lead de Teste", de: "Test-Lead hinzufügen", ar: "إضافة عميل تجريبي", zh: "添加测试线索", ja: "テストリードを追加" },
         "Clear local leads": { es: "Borrar leads locales", fr: "Effacer les prospects locaux", pt: "Limpar leads locais", de: "Lokale Leads löschen", ar: "مسح العملاء المحليين", zh: "清除本地线索", ja: "ローカルリードを消去" },
         "Total Leads": { es: "Leads Totales", fr: "Prospects Totaux", pt: "Total de Leads", de: "Leads gesamt", ar: "إجمالي العملاء", zh: "线索总数", ja: "リード合計" },
         "Cloud Synced": { es: "Sincronizados en la Nube", fr: "Synchronisés Cloud", pt: "Sincronizados na Nuvem", de: "Cloud-synchronisiert", ar: "متزامن مع السحابة", zh: "云端已同步", ja: "クラウド同期済み" },
         "Newest Lead": { es: "Lead Más Reciente", fr: "Prospect le Plus Récent", pt: "Lead Mais Recente", de: "Neuester Lead", ar: "أحدث عميل", zh: "最新线索", ja: "最新リード" },
         "No pilot leads yet": { es: "Aún no hay leads piloto", fr: "Aucun prospect pilote pour l'instant", pt: "Ainda não há leads piloto", de: "Noch keine Pilot-Leads", ar: "لا توجد طلبات تجريبية بعد", zh: "还没有试点线索", ja: "パイロットリードはまだありません" },
         "Open Pilot Signup": { es: "Abrir Registro Piloto", fr: "Ouvrir l'Inscription Pilote", pt: "Abrir Inscrição Piloto", de: "Pilot-Anmeldung öffnen", ar: "فتح تسجيل البرنامج التجريبي", zh: "打开试点注册", ja: "パイロット登録を開く" }
   };

   const originalTextNodes = new WeakMap();
   let suppressObserver = false;
   let pendingAutoTranslate = 0;

   function getLang() {
         return localStorage.getItem('occulert_lang') ||
                 navigator.language.slice(0,2) || 'en';
   }

   function normalizeText(value) {
         return String(value || '').replace(/\s+/g, ' ').trim();
   }

   function getTextTranslation(text, lang) {
         const original = normalizeText(text);
         if (!original || lang === 'en') return original;

         for (const [key, enText] of Object.entries(translations.en)) {
               if (normalizeText(enText) === original) {
                     return translations[lang][key] || original;
               }
         }

         const common = commonTextTranslations[original];
         return common && common[lang] ? common[lang] : original;
   }

   function shouldSkipNode(node) {
         const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
         if (!element || element.closest('.lang-switcher')) return true;
         return Boolean(element.closest('script,style,noscript,svg,canvas,video,audio,code,pre,textarea,select,[data-no-i18n]'));
   }

   function preserveWhitespace(source, translated) {
         const leading = source.match(/^\s*/)[0];
         const trailing = source.match(/\s*$/)[0];
         return leading + translated + trailing;
   }

   function translateTextNodes(lang, root) {
         const start = root || document.body;
         if (!start) return;
         const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
               acceptNode(node) {
                     if (shouldSkipNode(node) || !normalizeText(node.nodeValue)) {
                           return NodeFilter.FILTER_REJECT;
                     }
                     return NodeFilter.FILTER_ACCEPT;
               }
         });

         const nodes = [];
         while (walker.nextNode()) nodes.push(walker.currentNode);

         nodes.forEach(node => {
               if (!originalTextNodes.has(node)) {
                     originalTextNodes.set(node, normalizeText(node.nodeValue));
               }
               const source = originalTextNodes.get(node);
               const next = lang === 'en' ? source : getTextTranslation(source, lang);
               if (next && normalizeText(node.nodeValue) !== normalizeText(next)) {
                     node.nodeValue = preserveWhitespace(node.nodeValue, next);
               }
         });
   }

   function translateAttributes(lang, root) {
         const start = root || document;
         if (!start.querySelectorAll) return;
         const attrs = ['aria-label', 'title', 'placeholder', 'value'];
         start.querySelectorAll('[aria-label],[title],[placeholder],input[type="button"],input[type="submit"]').forEach(el => {
               if (shouldSkipNode(el)) return;
               attrs.forEach(attr => {
                     if (!el.hasAttribute(attr)) return;
                     const cacheAttr = 'data-i18n-original-' + attr;
                     if (!el.hasAttribute(cacheAttr)) {
                           el.setAttribute(cacheAttr, normalizeText(el.getAttribute(attr)));
                     }
                     const source = el.getAttribute(cacheAttr);
                     const next = lang === 'en' ? source : getTextTranslation(source, lang);
                     if (next) el.setAttribute(attr, next);
               });
         });
   }

   function translatePlainContent(lang, root) {
         suppressObserver = true;
         translateTextNodes(lang, root);
         translateAttributes(lang, root);
         suppressObserver = false;
   }

   function schedulePlainContentTranslation(root) {
         if (suppressObserver) return;
         window.clearTimeout(pendingAutoTranslate);
         pendingAutoTranslate = window.setTimeout(() => {
               const lang = getLang();
               if (lang !== 'en') translatePlainContent(lang, root || document.body);
         }, 50);
   }

   function setLang(lang) {
         if (!translations[lang]) lang = 'en';
         localStorage.setItem('occulert_lang', lang);
         document.documentElement.lang = lang;
         document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
         const t = translations[lang];
         document.querySelectorAll('[data-i18n]').forEach(el => {
                 const key = el.getAttribute('data-i18n');
                 if (key === 'disclaimer_text' && lang !== 'en') {
                         el.textContent = translations.en.disclaimer_text + ' English safety wording pending professional translation.';
                 } else if (t[key] !== undefined) {
                         el.textContent = t[key];
                 }
         });
         document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                 const key = el.getAttribute('data-i18n-placeholder');
                 if (t[key] !== undefined) el.setAttribute('placeholder', t[key]);
         });
         translatePlainContent(lang);
         // Update active state on selector
      document.querySelectorAll('.lang-option').forEach(btn => {
              btn.classList.toggle('active', btn.dataset.lang === lang);
      });
         // Update selector display
      const sel = document.querySelector('.lang-selected-label');
         if (sel) sel.textContent = LANG_NAMES[lang] || lang.toUpperCase();
   }

   function injectLangUI() {
         // Inject CSS
      if (!document.getElementById('lang-style')) {
              const style = document.createElement('style');
              style.id = 'lang-style';
              style.textContent = `
                      .lang-switcher{position:relative;display:flex;align-items:center}
                              .lang-btn{background:none;border:1px solid var(--border,#25344f);border-radius:8px;color:var(--text,#e2e8f0);padding:5px 10px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;transition:border-color .2s,background .2s}
                                      .lang-btn:hover{background:var(--surface,#121c2e);border-color:var(--border2,#344d72)}
                                              .lang-btn svg{flex-shrink:0}
                                                      .lang-dropdown{display:none;position:absolute;top:calc(100% + 6px);right:0;background:var(--surface,#121c2e);border:1px solid var(--border,#25344f);border-radius:10px;padding:6px;min-width:130px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.4)}
                                                              .lang-dropdown.open{display:block}
                                                                      .lang-option{display:block;width:100%;text-align:left;background:none;border:none;color:var(--text,#e2e8f0);padding:7px 10px;font-size:13px;cursor:pointer;border-radius:6px;transition:background .15s}
                                                                              .lang-option:hover{background:rgba(255,255,255,.07)}
                                                                                      .lang-option.active{color:#3b82f6;font-weight:600}
                                                                                              [dir=rtl] .lang-dropdown{right:auto;left:0}
                                                                                                      [dir=rtl] .lang-option{text-align:right}
                                                                                                              @media(max-width:720px){.lang-switcher{display:none}}
                                                                                                                    `;
              document.head.appendChild(style);
      }

      // Build dropdown HTML
      const optionsHTML = Object.entries(LANG_NAMES).map(([code, name]) =>
              `<button class="lang-option" data-lang="${code}">${name}</button>`
                                                             ).join('');

      const switcher = document.createElement('div');
         switcher.className = 'lang-switcher';
         switcher.innerHTML = `
               <button class="lang-btn" id="langToggle" aria-label="Select language" aria-haspopup="true" aria-expanded="false">
                       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                               <span class="lang-selected-label">English</span>
                                       <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                                             </button>
                                                   <div class="lang-dropdown" id="langDropdown">${optionsHTML}</div>
                                                       `;

      // Insert before theme toggle in nav-right
      const navRight = document.querySelector('.nav-right');
         if (navRight) {
                 navRight.insertBefore(switcher, navRight.firstChild);
         }

      // Toggle dropdown
      const btn = document.getElementById('langToggle');
         const dropdown = document.getElementById('langDropdown');
         if (btn && dropdown) {
                 btn.addEventListener('click', () => {
                           const open = dropdown.classList.toggle('open');
                           btn.setAttribute('aria-expanded', open);
                 });
                 // Close on outside click
           document.addEventListener('click', e => {
                     if (!switcher.contains(e.target)) {
                                 dropdown.classList.remove('open');
                                 btn.setAttribute('aria-expanded', false);
                     }
           });
                 // Language selection
           dropdown.querySelectorAll('.lang-option').forEach(opt => {
                     opt.addEventListener('click', () => {
                                 setLang(opt.dataset.lang);
                                 dropdown.classList.remove('open');
                                 btn.setAttribute('aria-expanded', false);
                     });
           });
         }
   }

   // Initialize
   document.addEventListener('DOMContentLoaded', function() {
         injectLangUI();
         const saved = getLang();
         const supported = Object.keys(translations);
         setLang(supported.includes(saved) ? saved : 'en');
         if (window.MutationObserver && document.body) {
               const observer = new MutationObserver(mutations => {
                     const changed = mutations.find(mutation => mutation.addedNodes.length || mutation.type === 'characterData');
                     if (changed) schedulePlainContentTranslation(document.body);
               });
               observer.observe(document.body, { childList: true, subtree: true, characterData: true });
         }
   });

   // Expose globally for console use
   window.OcculertLang = { setLang, getLang, translations, LANG_NAMES, commonTextTranslations };
})();
