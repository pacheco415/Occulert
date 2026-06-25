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
                  disclaimer_text: "Occulert is a supplemental alerting tool. It does not replace attentive driving, adequate rest, or compliance with traffic laws. Always maintain full attention while driving.",
                  stats_label1: "Crashes involve driver fatigue",
                  stats_label2: "Fatigue-related crashes per year in the US",
                  stats_label3: "Of drowsy drivers don't realize they're impaired",
                  stats_label4: "No subscription, no hardware required",
                  footer_privacy: "Privacy Policy",
                  footer_safety: "Safety & Liability",
                  footer_rights: "All rights reserved.",
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
                  footer_privacy: "Privacidad",
                  footer_safety: "Seguridad y Responsabilidad",
                  footer_rights: "Todos los derechos reservados.",
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
                  footer_privacy: "Confidentialité",
                  footer_safety: "Sécurité et Responsabilité",
                  footer_rights: "Tous droits réservés.",
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
                  footer_privacy: "Privacidade",
                  footer_safety: "Segurança e Responsabilidade",
                  footer_rights: "Todos os direitos reservados.",
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
                  trust3: "Keine Datenweitergabe",
                  disclaimer_title: "Sicherheitshinweis",
                  disclaimer_text: "Occulert ist ein ergänzendes Warnsystem. Es ersetzt keine aufmerksame Fahrweise, ausreichende Ruhe oder die Einhaltung der Verkehrsregeln.",
                  stats_label1: "Unfälle durch Fahrermüdigkeit",
                  stats_label2: "Müdigkeitsunfälle pro Jahr in den USA",
                  stats_label3: "Schläfrige Fahrer bemerken ihre Beeinträchtigung nicht",
                  stats_label4: "Kein Abonnement, keine Hardware",
                  footer_privacy: "Datenschutz",
                  footer_safety: "Sicherheit & Haftung",
                  footer_rights: "Alle Rechte vorbehalten.",
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
                  footer_privacy: "سياسة الخصوصية",
                  footer_safety: "السلامة والمسؤولية",
                  footer_rights: "جميع الحقوق محفوظة.",
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
                  footer_privacy: "隐私政策",
                  footer_safety: "安全与责任",
                  footer_rights: "保留所有权利。",
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
                  footer_privacy: "プライバシーポリシー",
                  footer_safety: "安全と責任",
                  footer_rights: "全著作権所有。",
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

   function getLang() {
         return localStorage.getItem('occulert_lang') ||
                 navigator.language.slice(0,2) || 'en';
   }

   function setLang(lang) {
         if (!translations[lang]) lang = 'en';
         localStorage.setItem('occulert_lang', lang);
         document.documentElement.lang = lang;
         document.documentElement.dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
         const t = translations[lang];
         document.querySelectorAll('[data-i18n]').forEach(el => {
                 const key = el.getAttribute('data-i18n');
                 if (t[key] !== undefined) el.textContent = t[key];
         });
         document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                 const key = el.getAttribute('data-i18n-placeholder');
                 if (t[key] !== undefined) el.setAttribute('placeholder', t[key]);
         });
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
   });

   // Expose globally for console use
   window.OcculertLang = { setLang, getLang, translations, LANG_NAMES };
})();
