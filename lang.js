// Occulert Language System
const LANGUAGES = {
  en: {
    name: 'English', flag: '🇺🇸', dir: 'ltr',
    nav: { how: 'How It Works', features: 'Features', devices: 'Devices', faq: 'FAQ', fleet: 'Fleet', donate: 'Donate', about: 'About', fleetBtn: 'Fleet Inquiry', launchBtn: 'Launch App →' },
    hero: { badge: 'AI driver safety — works on any phone', h1a: 'Stop Drowsy', h1b: 'Driving Before', h1c: 'It Stops You.', desc: "Occulert uses real-time AI eye-tracking to detect fatigue the moment it begins — then alerts you through your phone, watch, and earbuds before an accident happens.", btn1: 'Start Monitoring Free →', btn2: 'Fleet Solutions', trust1: 'No app needed', trust2: 'On-device AI', trust3: 'Real-time alerts' },
    stats: ['Americans killed by drowsy driving annually', 'Of fatal crashes involve driver fatigue', 'Alert response time from detection to alarm', 'Cost to protect yourself today'],
    drivers: { label: 'Real Drivers. Real Protection.', h2: 'Built for every driver on every road.', desc: "From Uber drivers working midnight shifts to Amazon delivery drivers running 200 stops a day — Occulert protects the people who keep America moving." },
    how: { label: 'How It Works', h2: 'Three steps. One life saved.', desc: 'Mount your phone, open Occulert, and drive. The AI handles everything else.', s1t: 'Mount Your Phone', s1d: "Clip your iPhone or Android to your dash mount so the front camera faces you. Works with any standard phone mount.", s2t: 'AI Watches Your Eyes', s2d: "Occulert tracks 468 facial landmarks and calculates your Eye Aspect Ratio 30 times per second. It detects drowsiness before you even feel it.", s3t: 'Instant Multi-Alert', s3d: "Phone vibrates, watch pulses, earbuds sound a warning — all at once. You wake up before anything goes wrong." },
    features: { label: 'Features', h2: 'Built for real roads. Not just demos.', desc: 'Every feature engineered for real-world driving.' },
    faq: { label: 'FAQ', h2: 'Questions drivers always ask.' },
    fleet: { label: 'Fleet & Commercial', h2: 'Protect every driver in your fleet.' },
    donate: { label: 'Support Occulert', h2: 'Help keep it free for every driver.', desc: 'Built by one person. Maintained by community support. Every dollar goes directly into making Occulert better.' },
    about: { label: 'Our Story', h2: 'Built on saving lives.', quote: '"No one should lose their life because they fell asleep at the wheel. That\'s why I built this — free, for every driver."' },
    cta: { h2: 'Start driving safer in 60 seconds.', desc: 'Free. No download. No account. Open it on any phone tonight.', btn1: 'Launch Occulert Free →', btn2: 'Contact for Fleet' },
    rating: { label: 'Rate Occulert', h2: 'How are we doing?', desc: 'Your rating helps us improve and shows other drivers Occulert is worth trusting.', submit: 'Submit Rating →', success: '🙏 Thank you! Your rating means everything to us.' },
    waitlist: { label: 'Stay Updated', h2: 'Get fleet updates & new features first.', btn: 'Join Waitlist →', note: 'No spam. Unsubscribe anytime.' },
  },
  es: {
    name: 'Español', flag: '🇪🇸', dir: 'ltr',
    nav: { how: 'Cómo Funciona', features: 'Características', devices: 'Dispositivos', faq: 'FAQ', fleet: 'Flota', donate: 'Donar', about: 'Nosotros', fleetBtn: 'Consulta Flota', launchBtn: 'Abrir App →' },
    hero: { badge: 'Seguridad vial con IA — funciona en cualquier teléfono', h1a: 'Detén el Manejo', h1b: 'Somnoliento Antes', h1c: 'De Que Te Detenga.', desc: "Occulert usa seguimiento ocular por IA en tiempo real para detectar fatiga y alertarte antes de que ocurra un accidente.", btn1: 'Comenzar Gratis →', btn2: 'Soluciones para Flota', trust1: 'Sin descargas', trust2: 'IA en tu dispositivo', trust3: 'Alertas en tiempo real' },
    stats: ['Americanos muertos por conducir somnoliento anualmente', 'De los accidentes fatales involucran fatiga', 'Tiempo de respuesta de alerta', 'Costo para protegerte hoy'],
    drivers: { label: 'Conductores Reales. Protección Real.', h2: 'Para cada conductor en cada carretera.', desc: "Desde conductores de Uber en turnos nocturnos hasta repartidores de Amazon — Occulert protege a las personas que mantienen America en movimiento." },
    how: { label: 'Cómo Funciona', h2: 'Tres pasos. Una vida salvada.', desc: 'Monta tu teléfono, abre Occulert, y maneja. La IA hace el resto.', s1t: 'Monta Tu Teléfono', s1d: "Coloca tu iPhone o Android en el tablero para que la cámara frontal te enfoque.", s2t: 'La IA Vigila Tus Ojos', s2d: "Occulert rastrea 468 puntos faciales y calcula tu Relación de Aspecto Ocular 30 veces por segundo.", s3t: 'Alerta Instantánea', s3d: "El teléfono vibra, el reloj pulsa, los auriculares suenan — todos al mismo tiempo." },
    features: { label: 'Características', h2: 'Hecho para carreteras reales. No solo demos.', desc: 'Cada función diseñada para la conducción real.' },
    faq: { label: 'Preguntas Frecuentes', h2: 'Lo que los conductores siempre preguntan.' },
    fleet: { label: 'Flota y Comercial', h2: 'Protege a cada conductor de tu flota.' },
    donate: { label: 'Apoya Occulert', h2: 'Ayuda a mantenerlo gratis para todos.', desc: 'Construido por una persona. Mantenido por el apoyo de la comunidad.' },
    about: { label: 'Nuestra Historia', h2: 'Construido para salvar vidas.', quote: '"Nadie debería perder la vida por quedarse dormido al volante. Por eso construí esto — gratis, para cada conductor."' },
    cta: { h2: 'Empieza a manejar más seguro en 60 segundos.', desc: 'Gratis. Sin descarga. Sin cuenta.', btn1: 'Abrir Occulert Gratis →', btn2: 'Contacto para Flota' },
    rating: { label: 'Califica Occulert', h2: '¿Cómo lo estamos haciendo?', desc: 'Tu calificación nos ayuda a mejorar.', submit: 'Enviar Calificación →', success: '🙏 ¡Gracias! Tu opinión significa todo.' },
    waitlist: { label: 'Mantente Informado', h2: 'Recibe actualizaciones primero.', btn: 'Unirse →', note: 'Sin spam. Cancela cuando quieras.' },
  },
  pt: {
    name: 'Português', flag: '🇧🇷', dir: 'ltr',
    nav: { how: 'Como Funciona', features: 'Recursos', devices: 'Dispositivos', faq: 'FAQ', fleet: 'Frota', donate: 'Apoiar', about: 'Sobre', fleetBtn: 'Consulta Frota', launchBtn: 'Abrir App →' },
    hero: { badge: 'Segurança com IA — funciona em qualquer celular', h1a: 'Pare de Dirigir', h1b: 'Sonolento Antes', h1c: 'Que Pare Você.', desc: "Occulert usa rastreamento ocular por IA em tempo real para detectar fadiga e alertar você antes de um acidente.", btn1: 'Começar Grátis →', btn2: 'Soluções para Frota', trust1: 'Sem download', trust2: 'IA no dispositivo', trust3: 'Alertas em tempo real' },
    stats: ['Americanos mortos por direção sonolenta anualmente', 'Dos acidentes fatais envolvem fadiga', 'Tempo de resposta do alerta', 'Custo para se proteger hoje'],
    drivers: { label: 'Motoristas Reais. Proteção Real.', h2: 'Para cada motorista em cada estrada.', desc: "De motoristas de Uber em turnos noturnos a entregadores da Amazon — Occulert protege quem mantém as estradas funcionando." },
    how: { label: 'Como Funciona', h2: 'Três passos. Uma vida salva.', desc: 'Monte seu celular, abra o Occulert e dirija.', s1t: 'Monte Seu Celular', s1d: "Coloque seu iPhone ou Android no suporte do painel para que a câmera frontal veja seu rosto.", s2t: 'IA Monitora Seus Olhos', s2d: "Occulert rastreia 468 pontos faciais e calcula sua Proporção de Aspecto Ocular 30 vezes por segundo.", s3t: 'Alerta Instantâneo', s3d: "Celular vibra, relógio pulsa, fones soam — tudo ao mesmo tempo." },
    features: { label: 'Recursos', h2: 'Feito para estradas reais.', desc: 'Cada recurso projetado para direção real.' },
    faq: { label: 'Perguntas Frequentes', h2: 'O que os motoristas sempre perguntam.' },
    fleet: { label: 'Frota e Comercial', h2: 'Proteja cada motorista da sua frota.' },
    donate: { label: 'Apoie o Occulert', h2: 'Ajude a mantê-lo gratuito.', desc: 'Construído por uma pessoa. Mantido pelo apoio da comunidade.' },
    about: { label: 'Nossa História', h2: 'Construído para salvar vidas.', quote: '"Ninguém deveria perder a vida por adormecer ao volante. Por isso construí isso — gratuito, para cada motorista."' },
    cta: { h2: 'Comece a dirigir com mais segurança em 60 segundos.', desc: 'Grátis. Sem download. Sem conta.', btn1: 'Abrir Occulert Grátis →', btn2: 'Contato para Frota' },
    rating: { label: 'Avalie o Occulert', h2: 'Como estamos indo?', desc: 'Sua avaliação nos ajuda a melhorar.', submit: 'Enviar Avaliação →', success: '🙏 Obrigado! Sua opinião significa tudo.' },
    waitlist: { label: 'Fique Atualizado', h2: 'Receba atualizações primeiro.', btn: 'Entrar na Lista →', note: 'Sem spam. Cancele quando quiser.' },
  },
  zh: {
    name: '中文', flag: '🇨🇳', dir: 'ltr',
    nav: { how: '工作原理', features: '功能', devices: '设备', faq: '常见问题', fleet: '车队', donate: '支持', about: '关于', fleetBtn: '车队咨询', launchBtn: '启动应用 →' },
    hero: { badge: 'AI驾驶安全 — 适用于任何手机', h1a: '在困倦驾驶', h1b: '阻止您之前', h1c: '先阻止它。', desc: "Occulert使用实时AI眼部追踪技术，在疲劳开始时立即检测，并通过手机、手表和耳机提醒您，防止事故发生。", btn1: '免费开始监测 →', btn2: '车队解决方案', trust1: '无需下载', trust2: '设备端AI', trust3: '实时提醒' },
    stats: ['每年因疲劳驾驶死亡的美国人', '致命事故涉及驾驶员疲劳', '检测到报警的响应时间', '今天保护自己的费用'],
    drivers: { label: '真实司机。真实保护。', h2: '为每条路上的每位司机而建。', desc: "从深夜工作的Uber司机到每天跑200个站点的亚马逊快递员 — Occulert保护着让美国运转的人们。" },
    how: { label: '工作原理', h2: '三步。一条生命得救。', desc: '安装手机，打开Occulert，然后驾驶。AI负责其余的一切。', s1t: '安装手机', s1d: "将iPhone或Android手机夹在仪表盘上，让前置摄像头面对您。", s2t: 'AI监视您的眼睛', s2d: "Occulert追踪468个面部标志点，每秒计算眼部纵横比30次。", s3t: '即时多设备提醒', s3d: "手机振动、手表脉冲、耳机报警 — 同时进行。在任何事故发生前唤醒您。" },
    features: { label: '功能特点', h2: '为真实道路而建。', desc: '每个功能都专为真实驾驶场景设计。' },
    faq: { label: '常见问题', h2: '司机们经常问的问题。' },
    fleet: { label: '车队与商业', h2: '保护您车队中的每位司机。' },
    donate: { label: '支持Occulert', h2: '帮助它对每位司机免费。', desc: '由一个人构建。由社区支持维护。' },
    about: { label: '我们的故事', h2: '为拯救生命而建。', quote: '"没有人应该因为在方向盘上睡着而失去生命。这就是为什么我建造了这个 — 免费，为每一位司机。"' },
    cta: { h2: '60秒内开始更安全地驾驶。', desc: '免费。无需下载。无需账户。', btn1: '免费启动Occulert →', btn2: '车队联系' },
    rating: { label: '评价Occulert', h2: '我们做得怎么样？', desc: '您的评分帮助我们改进。', submit: '提交评分 →', success: '🙏 谢谢！您的反馈对我们意义重大。' },
    waitlist: { label: '保持更新', h2: '优先获取车队更新和新功能。', btn: '加入等待列表 →', note: '无垃圾邮件。随时取消。' },
  },
  fr: {
    name: 'Français', flag: '🇫🇷', dir: 'ltr',
    nav: { how: 'Comment ça marche', features: 'Fonctionnalités', devices: 'Appareils', faq: 'FAQ', fleet: 'Flotte', donate: 'Soutenir', about: 'À propos', fleetBtn: 'Demande flotte', launchBtn: "Lancer l'app →" },
    hero: { badge: "Sécurité IA — fonctionne sur n'importe quel téléphone", h1a: 'Arrêtez la Conduite', h1b: 'Somnolente Avant', h1c: "Qu'elle Vous Arrête.", desc: "Occulert utilise le suivi oculaire par IA en temps réel pour détecter la fatigue dès qu'elle commence et vous alerter avant qu'un accident se produise.", btn1: 'Commencer Gratuitement →', btn2: 'Solutions Flotte', trust1: 'Sans téléchargement', trust2: 'IA sur appareil', trust3: 'Alertes temps réel' },
    stats: ["Américains tués par somnolence au volant chaque année", "Des accidents mortels impliquent la fatigue", "Temps de réponse de l'alerte", 'Coût pour vous protéger aujourd\'hui'],
    drivers: { label: 'Vrais Conducteurs. Vraie Protection.', h2: 'Pour chaque conducteur sur chaque route.', desc: "Des chauffeurs Uber en service de nuit aux livreurs Amazon — Occulert protège ceux qui font tourner les routes." },
    how: { label: 'Comment Ça Marche', h2: 'Trois étapes. Une vie sauvée.', desc: "Montez votre téléphone, ouvrez Occulert et conduisez. L'IA s'occupe du reste.", s1t: 'Montez Votre Téléphone', s1d: "Fixez votre iPhone ou Android sur le tableau de bord pour que la caméra frontale vous fasse face.", s2t: "L'IA Surveille Vos Yeux", s2d: "Occulert suit 468 points du visage et calcule votre ratio d'aspect oculaire 30 fois par seconde.", s3t: 'Alerte Multi-Appareils', s3d: "Le téléphone vibre, la montre pulse, les écouteurs sonnent — tout en même temps." },
    features: { label: 'Fonctionnalités', h2: 'Conçu pour les vraies routes.', desc: 'Chaque fonctionnalité conçue pour la conduite réelle.' },
    faq: { label: 'Questions Fréquentes', h2: 'Ce que les conducteurs demandent toujours.' },
    fleet: { label: 'Flotte et Commercial', h2: 'Protégez chaque conducteur de votre flotte.' },
    donate: { label: 'Soutenir Occulert', h2: 'Aidez à le garder gratuit.', desc: 'Construit par une personne. Maintenu par le soutien communautaire.' },
    about: { label: 'Notre Histoire', h2: 'Construit pour sauver des vies.', quote: '"Personne ne devrait perdre la vie parce qu\'il s\'est endormi au volant. C\'est pourquoi j\'ai construit ceci — gratuitement, pour chaque conducteur."' },
    cta: { h2: 'Commencez à conduire plus sûrement en 60 secondes.', desc: 'Gratuit. Sans téléchargement. Sans compte.', btn1: 'Lancer Occulert Gratuitement →', btn2: 'Contact Flotte' },
    rating: { label: 'Notez Occulert', h2: 'Comment nous en sortons-nous?', desc: 'Votre note nous aide à nous améliorer.', submit: 'Soumettre →', success: '🙏 Merci! Votre avis compte énormément.' },
    waitlist: { label: 'Restez Informé', h2: 'Recevez les mises à jour en premier.', btn: 'Rejoindre →', note: 'Pas de spam. Désinscription facile.' },
  },
  ar: {
    name: 'العربية', flag: '🇸🇦', dir: 'rtl',
    nav: { how: 'كيف يعمل', features: 'المميزات', devices: 'الأجهزة', faq: 'الأسئلة', fleet: 'الأسطول', donate: 'ادعم', about: 'من نحن', fleetBtn: 'استفسار الأسطول', launchBtn: 'تشغيل التطبيق ←' },
    hero: { badge: 'أمان السائق بالذكاء الاصطناعي — يعمل على أي هاتف', h1a: 'أوقف القيادة', h1b: 'بحالة نعاس', h1c: 'قبل أن تُوقفك.', desc: "يستخدم Occulert تتبع العين بالذكاء الاصطناعي في الوقت الفعلي لاكتشاف الإرهاق في اللحظة التي يبدأ فيها وتنبيهك قبل وقوع حادث.", btn1: 'ابدأ المراقبة مجاناً ←', btn2: 'حلول الأسطول', trust1: 'لا تنزيل', trust2: 'ذكاء اصطناعي محلي', trust3: 'تنبيهات فورية' },
    stats: ['أمريكي يُقتل بسبب القيادة في حالة نعاس سنوياً', 'من الحوادث المميتة تتضمن إرهاق السائق', 'وقت استجابة التنبيه', 'تكلفة حماية نفسك اليوم'],
    drivers: { label: 'سائقون حقيقيون. حماية حقيقية.', h2: 'مصنوع لكل سائق على كل طريق.', desc: "من سائقي أوبر في المناوبات الليلية إلى سائقي أمازون — Occulert يحمي الناس الذين يُبقون أمريكا تتحرك." },
    how: { label: 'كيف يعمل', h2: 'ثلاث خطوات. حياة واحدة تُنقذ.', desc: 'ثبّت هاتفك وافتح Occulert وقُد. الذكاء الاصطناعي يتولى الباقي.', s1t: 'ثبّت هاتفك', s1d: "ضع iPhone أو Android على حامل لوحة القيادة بحيث تواجه الكاميرا الأمامية وجهك.", s2t: 'الذكاء الاصطناعي يراقب عينيك', s2d: "Occulert يتتبع 468 نقطة في الوجه ويحسب نسبة جهة العين 30 مرة في الثانية.", s3t: 'تنبيه فوري متعدد الأجهزة', s3d: "الهاتف يهتز والساعة تنبض والسماعات تصدر صوتاً — كل شيء في آنٍ واحد." },
    features: { label: 'المميزات', h2: 'مصنوع للطرق الحقيقية.', desc: 'كل ميزة مصممة للقيادة الفعلية.' },
    faq: { label: 'الأسئلة الشائعة', h2: 'ما يسأله السائقون دائماً.' },
    fleet: { label: 'الأسطول والتجاري', h2: 'احمِ كل سائق في أسطولك.' },
    donate: { label: 'ادعم Occulert', h2: 'ساعد في إبقائه مجانياً.', desc: 'بُني من قِبل شخص واحد. يُصان بدعم المجتمع.' },
    about: { label: 'قصتنا', h2: 'مبني لإنقاذ الأرواح.', quote: '"لا ينبغي لأحد أن يفقد حياته لأنه نام خلف المقود. لهذا بنيت هذا — مجاناً، لكل سائق."' },
    cta: { h2: 'ابدأ القيادة بأمان في 60 ثانية.', desc: 'مجاني. بدون تنزيل. بدون حساب.', btn1: 'تشغيل Occulert مجاناً ←', btn2: 'تواصل للأسطول' },
    rating: { label: 'قيّم Occulert', h2: 'كيف نحن؟', desc: 'تقييمك يساعدنا على التحسين.', submit: 'إرسال التقييم ←', success: '🙏 شكراً! رأيك يعني لنا الكثير.' },
    waitlist: { label: 'ابقَ على اطلاع', h2: 'احصل على التحديثات أولاً.', btn: 'انضم للقائمة ←', note: 'لا بريد مزعج. إلغاء الاشتراك في أي وقت.' },
  },
};

// Current language
let currentLang = localStorage.getItem('occulert-lang') || 'en';

function applyLanguage(lang) {
  const t = LANGUAGES[lang];
  if (!t) return;
  currentLang = lang;
  localStorage.setItem('occulert-lang', lang);

  // Set RTL direction
  document.documentElement.dir = t.dir;
  document.documentElement.lang = lang;

  // Apply translations to elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const keys = key.split('.');
    let val = t;
    for (const k of keys) { val = val?.[k]; }
    if (val !== undefined) el.textContent = val;
  });

  // Apply HTML translations
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    const keys = key.split('.');
    let val = t;
    for (const k of keys) { val = val?.[k]; }
    if (val !== undefined) el.innerHTML = val;
  });

  // Update lang switcher display
  const display = document.getElementById('lang-display');
  if (display) display.textContent = `${t.flag} ${t.name}`;

  // Mark active
  document.querySelectorAll('.lang-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.lang === lang);
  });

  // Dispatch event for components that need to re-render
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang, t } }));
}

function buildLangSwitcher(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="lang-switcher">
      <button class="lang-trigger" onclick="toggleLangMenu()" id="lang-display">
        ${LANGUAGES[currentLang].flag} ${LANGUAGES[currentLang].name}
      </button>
      <div class="lang-menu" id="lang-menu">
        ${Object.entries(LANGUAGES).map(([code, l]) => `
          <div class="lang-option ${code === currentLang ? 'active' : ''}" data-lang="${code}" onclick="selectLang('${code}')">
            <span>${l.flag}</span>
            <span>${l.name}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleLangMenu() {
  document.getElementById('lang-menu').classList.toggle('open');
}

function selectLang(lang) {
  applyLanguage(lang);
  document.getElementById('lang-menu').classList.remove('open');
}

// Close menu when clicking outside
document.addEventListener('click', e => {
  const menu = document.getElementById('lang-menu');
  if (menu && !e.target.closest('.lang-switcher')) menu.classList.remove('open');
});

// Apply on load
document.addEventListener('DOMContentLoaded', () => {
  applyLanguage(currentLang);
});

// Export
window.OcculertLang = { apply: applyLanguage, build: buildLangSwitcher, languages: LANGUAGES, current: () => currentLang };
