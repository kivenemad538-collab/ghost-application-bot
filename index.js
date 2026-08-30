require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

// ============================================================
// كل الآيديات والإعدادات هنا فقط - غيّر الأرقام ولا تغيّر الأسماء
// ============================================================
const CONFIG = {
  GUILD_ID: '1535754836061065318',
  SERVER_NAME: 'Ghost',

  // صور مباشرة بصيغة PNG/JPG/WebP. اتركها فارغة لاستخدام بانر السيرفر.
  SERVER_BANNER_URL: 'https://cdn.discordapp.com/attachments/1537192093901135892/1543744467784441976/ChatGPT_Image_Aug_9_2026_06_54_02_PM.png?ex=6a95fb92&is=6a94aa12&hm=7e438d7b870fc35e5112c5a70f8f2d88e6c69abea0fae975c6a772826ca16d48&',

  CHANNELS: {
    WELCOME: '1538611932624453783',
    RULES: '1535773187676315688',
    APPLY: '1535785755090223105',
    APPLICATION_RESULTS: '1543742366433935500',
    VOICE_PANEL: '1543742818822914108',
    VOICE_REVIEW: '1543742366433935500',
    CONTROL: '1536347609164161034',
    INTERVIEW_WAITING: '1535785755090223105',
  },

  ROLES: {
    AUTO_MEMBER: '1535763946596728902',
    APPLICATION_REVIEWER: '1535755748297146398',
    TEXT_ACCEPTED: '1535767262580047923',
    ENTRY_PERMIT: '1535764584152043601',
  },

  // هذه الرولات فقط تستطيع استخدام الكنترول والقبول والرفض.
  STAFF_ROLE_IDS: [
    '1535754877882474557',
    '1535754908261941350',
    '1535759833427480576'
  ],

  // تستطيع إضافة أو حذف الأسئلة كما تريد.
  APPLICATION_QUESTIONS: [
    'ما اسمك؟',
    'كم عمرك؟',
    'ما اسمك داخل الرول بلاي؟',
    'كم عدد ساعات لعبك في FiveM؟',
    'هل سبق أن كنت إداريًا؟ اذكر خبرتك.',
    'لماذا تريد الانضمام إلى إدارة Ghost؟',
    'كم ساعة تستطيع التواجد يوميًا؟',
    'ماذا تفعل إذا رأيت إداريًا يخالف القوانين؟',
  ],

  DEFAULT_CLOSED_MESSAGE: 'التقديم مغلق حاليًا، وسيتم الإعلان عند فتحه مرة أخرى.',
  COLORS: {
    MAIN: 0x1677ff,
    SUCCESS: 0x22c55e,
    DANGER: 0xef4444,
    WARNING: 0xf59e0b,
  },
};

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const DEFAULT_DATA = {
  applicationsOpen: true,
  closedMessage: CONFIG.DEFAULT_CLOSED_MESSAGE,
  activeApplicants: [],
  pendingApplications: [],
  pendingVoiceApplicants: [],
};

function loadData() {
  try {
    return { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

let data = loadData();
data.activeApplicants = Array.isArray(data.activeApplicants) ? data.activeApplicants : [];
data.pendingApplications = Array.isArray(data.pendingApplications) ? data.pendingApplications : [];
data.pendingVoiceApplicants = Array.isArray(data.pendingVoiceApplicants) ? data.pendingVoiceApplicants : [];
const processingReviews = new Set();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

function isConfigured(value) {
  return value && !String(value).startsWith('PUT_');
}

function channelUrl(channelId) {
  return `https://discord.com/channels/${CONFIG.GUILD_ID}/${channelId}`;
}

function bannerFor(guild) {
  return CONFIG.SERVER_BANNER_URL || guild.bannerURL({ size: 2048 }) || null;
}

function panelEmbed(title, description, color = CONFIG.COLORS.MAIN) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${CONFIG.SERVER_NAME} • جميع الحقوق محفوظة` })
    .setTimestamp();
}

function staffOnly(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return CONFIG.STAFF_ROLE_IDS.some(id => member.roles.cache.has(id));
}

function reviewerMention() {
  return isConfigured(CONFIG.ROLES.APPLICATION_REVIEWER)
    ? `<@&${CONFIG.ROLES.APPLICATION_REVIEWER}>`
    : '';
}

function reviewButtons(prefix, applicantId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_accept:${applicantId}`)
      .setLabel('قبول')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${prefix}_reject:${applicantId}`)
      .setLabel('رفض بسبب')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );
}

function disableRows(message) {
  return message.components.map(row => {
    const newRow = ActionRowBuilder.from(row);
    newRow.components = newRow.components.map(button => ButtonBuilder.from(button).setDisabled(true));
    return newRow;
  });
}

async function safeDM(user, payload) {
  try {
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

async function sendWelcome(member) {
  const channel = member.guild.channels.cache.get(CONFIG.CHANNELS.WELCOME);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.MAIN)
    .setAuthor({ name: `مرحبًا بك في ${CONFIG.SERVER_NAME}`, iconURL: member.user.displayAvatarURL() })
    .setTitle(`أهلًا ${member.user.username} 👋`)
    .setDescription(`نورت **${CONFIG.SERVER_NAME}** يا ${member}. اقرأ القوانين ثم توجّه إلى التقديم، ونتمنى لك وقتًا ممتعًا معنا.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
    .setImage(bannerFor(member.guild))
    .setFooter({ text: `العضو رقم ${member.guild.memberCount}` })
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('القوانين').setEmoji('📜').setStyle(ButtonStyle.Link).setURL(channelUrl(CONFIG.CHANNELS.RULES)),
    new ButtonBuilder().setLabel('التقديم').setEmoji('📝').setStyle(ButtonStyle.Link).setURL(channelUrl(CONFIG.CHANNELS.APPLY)),
  );

  await channel.send({ content: `${member}`, embeds: [embed], components: [buttons] });
}

async function startApplication(interaction) {
  if (!data.applicationsOpen) {
    return interaction.reply({
      embeds: [panelEmbed('التقديم مغلق', data.closedMessage, CONFIG.COLORS.WARNING)],
      ephemeral: true,
    });
  }

  if (data.activeApplicants.includes(interaction.user.id)) {
    return interaction.reply({ content: 'لديك تقديم جارٍ بالفعل في الخاص.', ephemeral: true });
  }

  if (data.pendingApplications.includes(interaction.user.id)) {
    return interaction.reply({ content: 'تقديمك الإداري موجود بالفعل وقيد المراجعة.', ephemeral: true });
  }

  const member = interaction.member;
  if (isConfigured(CONFIG.ROLES.TEXT_ACCEPTED) && member.roles.cache.has(CONFIG.ROLES.TEXT_ACCEPTED)) {
    return interaction.reply({ content: 'تم قبولك في التقديم الكتابي بالفعل. توجّه إلى مرحلة التقديم الصوتي.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const dm = await safeDM(interaction.user, {
    embeds: [panelEmbed(
      `تقديم إدارة ${CONFIG.SERVER_NAME}`,
      'سيتم إرسال الأسئلة واحدًا تلو الآخر. لديك **5 دقائق** للإجابة عن كل سؤال. اكتب `إلغاء` في أي وقت لإيقاف التقديم.'
    )],
  });

  if (!dm) {
    return interaction.editReply({ content: 'تعذر فتح الخاص. فعّل استقبال الرسائل الخاصة من أعضاء السيرفر ثم حاول مجددًا.' });
  }

  await interaction.editReply({ content: 'تم إرسال التقديم لك في الخاص 📩' });
  data.activeApplicants.push(interaction.user.id);
  saveData();

  const answers = [];
  const dmChannel = await interaction.user.createDM();

  try {
    for (let index = 0; index < CONFIG.APPLICATION_QUESTIONS.length; index++) {
      const question = CONFIG.APPLICATION_QUESTIONS[index];
      await dmChannel.send({
        embeds: [panelEmbed(
          `السؤال ${index + 1} من ${CONFIG.APPLICATION_QUESTIONS.length}`,
          question
        )],
      });

      const collected = await dmChannel.awaitMessages({
        filter: message => message.author.id === interaction.user.id,
        max: 1,
        time: 5 * 60 * 1000,
        errors: ['time'],
      });

      const answer = collected.first().content.trim();
      if (answer === 'إلغاء') throw new Error('CANCELLED');
      answers.push(answer.slice(0, 1500));
    }

    const resultChannel = await client.channels.fetch(CONFIG.CHANNELS.APPLICATION_RESULTS);
    if (!resultChannel?.isTextBased()) throw new Error('RESULT_CHANNEL');

    const fields = answers.map((answer, index) => ({
      name: `${index + 1}) ${CONFIG.APPLICATION_QUESTIONS[index]}`.slice(0, 256),
      value: answer || 'بدون إجابة',
    }));

    const chunks = [];
    for (let i = 0; i < fields.length; i += 5) chunks.push(fields.slice(i, i + 5));

    const embeds = chunks.map((chunk, index) => new EmbedBuilder()
      .setColor(CONFIG.COLORS.MAIN)
      .setTitle(index === 0 ? `تقديم جديد • ${interaction.user.username}` : `تكملة التقديم • ${interaction.user.username}`)
      .setDescription(index === 0 ? `المتقدم: ${interaction.user}\nالآيدي: \`${interaction.user.id}\`` : null)
      .addFields(chunk)
      .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
      .setTimestamp());

    await resultChannel.send({
      content: `${reviewerMention()} تقديم من ${interaction.user}`.trim(),
      embeds,
      components: [reviewButtons('app', interaction.user.id)],
      allowedMentions: { roles: isConfigured(CONFIG.ROLES.APPLICATION_REVIEWER) ? [CONFIG.ROLES.APPLICATION_REVIEWER] : [] },
    });

    if (!data.pendingApplications.includes(interaction.user.id)) {
      data.pendingApplications.push(interaction.user.id);
      saveData();
    }

    await dmChannel.send({
      embeds: [panelEmbed('تم استلام تقديمك', 'تقديمك الآن قيد المراجعة. سيتم إرسال النتيجة لك هنا عند اتخاذ القرار.', CONFIG.COLORS.SUCCESS)],
    });
  } catch (error) {
    if (error.message === 'CANCELLED') {
      await safeDM(interaction.user, 'تم إلغاء التقديم.');
    } else if (error.message === 'RESULT_CHANNEL') {
      await safeDM(interaction.user, 'حدث خطأ في روم استلام التقديمات. تواصل مع الإدارة.');
    } else {
      await safeDM(interaction.user, 'انتهى الوقت المسموح للإجابة. يمكنك بدء تقديم جديد من البانل.');
    }
  } finally {
    data.activeApplicants = data.activeApplicants.filter(id => id !== interaction.user.id);
    saveData();
  }
}

async function acceptWritten(interaction, applicantId) {
  if (!beginReview(interaction.message.id)) {
    return interaction.reply({ content: 'جاري تنفيذ قرار آخر على هذا التقديم.', ephemeral: true });
  }
  await interaction.deferUpdate();
  try {
    const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
    if (!member) return interaction.followUp({ content: 'العضو غير موجود في السيرفر.', ephemeral: true });

    if (isConfigured(CONFIG.ROLES.TEXT_ACCEPTED)) {
      await member.roles.add(CONFIG.ROLES.TEXT_ACCEPTED, `قبول التقديم بواسطة ${interaction.user.tag}`);
    }

    data.pendingApplications = data.pendingApplications.filter(id => id !== applicantId);
    saveData();
    await interaction.message.edit({
      embeds: reviewedEmbeds(interaction.message, 'مقبول', interaction.user),
      components: [],
    });
    await interaction.followUp({ content: `تم قبول ${member} ومنحه رول المقبول.`, ephemeral: true });
    await safeDM(member.user, {
      embeds: [panelEmbed(
        'تم قبول تقديمك الكتابي ✅',
        `مبروك! تم قبولك مبدئيًا في إدارة **${CONFIG.SERVER_NAME}**. بقيت لك المقابلة الصوتية؛ توجّه إلى <#${CONFIG.CHANNELS.INTERVIEW_WAITING}> وانتظر تعليمات الإدارة.`,
        CONFIG.COLORS.SUCCESS
      )],
    });
  } finally {
    processingReviews.delete(interaction.message.id);
  }
}

function rejectModal(prefix, applicantId) {
  return new ModalBuilder()
    .setCustomId(`${prefix}_reject_modal:${applicantId}`)
    .setTitle('سبب الرفض')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('اكتب سبب الرفض بوضوح')
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(3)
        .setMaxLength(1000)
        .setRequired(true)
    ));
}

async function finishReject(interaction, applicantId, stage) {
  if (!beginReview(interaction.message.id)) {
    return interaction.reply({ content: 'جاري تنفيذ قرار آخر على هذا التقديم.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const reason = interaction.fields.getTextInputValue('reason');
    const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
    const user = member?.user || await client.users.fetch(applicantId).catch(() => null);
    const title = stage === 'voice' ? 'نتيجة المقابلة الصوتية' : 'نتيجة التقديم الإداري';

    if (user) {
      await safeDM(user, {
        embeds: [panelEmbed(
          `${title} ❌`,
          `نأسف، لم يتم قبولك في هذه المرحلة.\n\n**السبب:**\n${reason}\n\nنتمنى لك التوفيق.`,
          CONFIG.COLORS.DANGER
        )],
      });
    }

    if (stage === 'voice') data.pendingVoiceApplicants = data.pendingVoiceApplicants.filter(id => id !== applicantId);
    else data.pendingApplications = data.pendingApplications.filter(id => id !== applicantId);
    saveData();

    await interaction.message.edit({
      embeds: reviewedEmbeds(interaction.message, 'مرفوض', interaction.user, reason),
      components: [],
    }).catch(() => {});
    await interaction.editReply({ content: `تم رفض <@${applicantId}> وإرسال السبب في الخاص.` });
  } finally {
    processingReviews.delete(interaction.message.id);
  }
}

function voiceApplicantIdModal() {
  return new ModalBuilder()
    .setCustomId('voice_applicant_id_modal')
    .setTitle('إضافة تقديم صوتي')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('applicant_id')
        .setLabel('اكتب آيدي الشخص')
        .setPlaceholder('مثال: 123456789012345678')
        .setStyle(TextInputStyle.Short)
        .setMinLength(17)
        .setMaxLength(20)
        .setRequired(true)
    ));
}

function reviewedEmbeds(message, status, reviewer, reason = null) {
  return message.embeds.map((oldEmbed, index) => {
    const embed = EmbedBuilder.from(oldEmbed);
    if (index === 0) {
      embed.setColor(status === 'مقبول' ? CONFIG.COLORS.SUCCESS : CONFIG.COLORS.DANGER);
      embed.addFields(
        { name: 'الحالة', value: status === 'مقبول' ? '✅ مقبول' : '❌ مرفوض', inline: true },
        { name: 'تمت المراجعة بواسطة', value: `${reviewer}`, inline: true },
      );
      if (reason) embed.addFields({ name: 'سبب الرفض', value: reason.slice(0, 1024) });
      embed.setFooter({ text: `${CONFIG.SERVER_NAME} • تمت المراجعة` }).setTimestamp();
    }
    return embed;
  });
}

function beginReview(messageId) {
  if (processingReviews.has(messageId)) return false;
  processingReviews.add(messageId);
  return true;
}

async function registerVoiceById(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const applicantId = interaction.fields.getTextInputValue('applicant_id').trim();

  if (!/^\d{17,20}$/.test(applicantId)) {
    return interaction.editReply({ content: 'الآيدي غير صحيح. اكتب آيدي ديسكورد أرقام فقط.' });
  }

  const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
  if (!member) {
    return interaction.editReply({ content: 'لم أجد هذا الشخص داخل السيرفر. تأكد من الآيدي.' });
  }

  if (member.user.bot) {
    return interaction.editReply({ content: 'لا يمكن تسجيل بوت في المقابلة الصوتية.' });
  }

  if (isConfigured(CONFIG.ROLES.ENTRY_PERMIT) && member.roles.cache.has(CONFIG.ROLES.ENTRY_PERMIT)) {
    return interaction.editReply({ content: 'هذا الشخص لديه رول تصريح الدخول بالفعل.' });
  }

  if (data.pendingVoiceApplicants.includes(applicantId)) {
    return interaction.editReply({ content: 'هذا الشخص لديه تقديم صوتي قيد المراجعة بالفعل.' });
  }

  const reviewChannel = await client.channels.fetch(CONFIG.CHANNELS.VOICE_REVIEW).catch(() => null);
  if (!reviewChannel?.isTextBased()) {
    return interaction.editReply({ content: 'روم مراجعة التقديم الصوتي غير مضبوط.' });
  }

  const dmSent = await safeDM(member.user, {
    embeds: [panelEmbed(
      'تقديمك الصوتي قيد المراجعة 🎙️',
      `تم تسجيل تقديمك في مرحلة المقابلة الصوتية لإدارة **${CONFIG.SERVER_NAME}**، وهو الآن قيد المراجعة. ستصلك النتيجة هنا في الخاص سواء بالقبول أو الرفض مع السبب.`,
      CONFIG.COLORS.WARNING
    )],
  });

  const embed = panelEmbed(
    'تقديم صوتي جديد',
    `المتقدم: ${member}\nالاسم: **${member.user.username}**\nالآيدي: \`${member.id}\`\nسجله للمراجعة: ${interaction.user}\n\nاختَر القبول لمنحه تصريح الدخول، أو الرفض واكتب السبب.`
  ).setThumbnail(member.user.displayAvatarURL({ size: 256 }));

  await reviewChannel.send({
    content: `${reviewerMention()} تقديم صوتي من ${member}`.trim(),
    embeds: [embed],
    components: [reviewButtons('voice', member.id)],
    allowedMentions: {
      roles: isConfigured(CONFIG.ROLES.APPLICATION_REVIEWER) ? [CONFIG.ROLES.APPLICATION_REVIEWER] : [],
      users: [member.id],
    },
  });

  data.pendingVoiceApplicants.push(applicantId);
  saveData();

  return interaction.editReply({
    content: `تم تسجيل التقديم الصوتي لـ ${member} وإرساله إلى روم المراجعة.${dmSent ? '\nتم إبلاغه في الخاص.' : '\nتعذر إرسال الخاص له لأن رسائله مغلقة.'}`,
  });
}

async function acceptVoice(interaction, applicantId) {
  if (!beginReview(interaction.message.id)) {
    return interaction.reply({ content: 'جاري تنفيذ قرار آخر على هذا التقديم.', ephemeral: true });
  }
  await interaction.deferUpdate();
  try {
    const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
    if (!member) return interaction.followUp({ content: 'العضو غير موجود في السيرفر.', ephemeral: true });

    if (isConfigured(CONFIG.ROLES.ENTRY_PERMIT)) {
      await member.roles.add(CONFIG.ROLES.ENTRY_PERMIT, `اجتاز المقابلة الصوتية بواسطة ${interaction.user.tag}`);
    }

    data.pendingVoiceApplicants = data.pendingVoiceApplicants.filter(id => id !== applicantId);
    saveData();
    await interaction.message.edit({
      embeds: reviewedEmbeds(interaction.message, 'مقبول', interaction.user),
      components: [],
    });
    await interaction.followUp({ content: `تم قبول ${member} ومنحه تصريح الدخول.`, ephemeral: true });
    await safeDM(member.user, {
      embeds: [panelEmbed(
        'تم قبولك في المقابلة الصوتية ✅',
        `مبروك! اجتزت جميع مراحل التقديم في **${CONFIG.SERVER_NAME}** وتم منحك **رول تصريح الدخول**. نتمنى لك التوفيق معنا.`,
        CONFIG.COLORS.SUCCESS
      )],
    });
  } finally {
    processingReviews.delete(interaction.message.id);
  }
}

function controlRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('control_open').setLabel('فتح التقديم').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('control_close').setLabel('قفل التقديم').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('control_message').setLabel('تعديل رسالة الإغلاق').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('control_status').setLabel('الحالة').setEmoji('📊').setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function panelAlreadyExists(channel, customId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;
  return messages.some(message =>
    message.author.id === client.user.id &&
    message.components.some(row => row.components.some(component => component.customId === customId))
  );
}

async function sendPanels() {
  const apply = await client.channels.fetch(CONFIG.CHANNELS.APPLY).catch(() => null);
  if (apply?.isTextBased() && !(await panelAlreadyExists(apply, 'start_application'))) {
    await apply.send({
      embeds: [panelEmbed(
        `التقديم على إدارة ${CONFIG.SERVER_NAME}`,
        'اضغط الزر أدناه لبدء التقديم. ستصلك الأسئلة في الخاص سؤالًا بعد سؤال، وبعد الانتهاء يتم إرسال تقديمك إلى لجنة المراجعة.'
      )],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_application').setLabel('بدء التقديم').setEmoji('📝').setStyle(ButtonStyle.Primary)
      )],
    });
  }

  const voice = await client.channels.fetch(CONFIG.CHANNELS.VOICE_PANEL).catch(() => null);
  if (voice?.isTextBased() && !(await panelAlreadyExists(voice, 'add_voice_applicant'))) {
    await voice.send({
      embeds: [panelEmbed(
        'كنترول المقابلة الصوتية',
        'هذا البانل مخصص للإدارة. اضغط الزر، ثم اكتب آيدي الشخص الذي قدّم صوتي. سيتم إبلاغه في الخاص وإرسال طلبه إلى روم المراجعة للقبول أو الرفض بسبب.'
      )],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('add_voice_applicant').setLabel('كتابة آيدي المتقدم').setEmoji('🎙️').setStyle(ButtonStyle.Primary)
      )],
    });
  }

  const control = await client.channels.fetch(CONFIG.CHANNELS.CONTROL).catch(() => null);
  if (control?.isTextBased() && !(await panelAlreadyExists(control, 'control_open'))) {
    await control.send({
      embeds: [panelEmbed('كنترول التقديم', 'من هنا تستطيع فتح أو قفل التقديم وتحديد الرسالة التي تظهر للأعضاء عند الإغلاق.')],
      components: controlRows(),
    });
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity(`${CONFIG.SERVER_NAME} Applications`);
});

client.on('guildMemberAdd', async member => {
  try {
    if (isConfigured(CONFIG.ROLES.AUTO_MEMBER)) await member.roles.add(CONFIG.ROLES.AUTO_MEMBER);
    await sendWelcome(member);
  } catch (error) {
    console.error('Welcome error:', error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      const [action, applicantId] = interaction.customId.split(':');

      if (action === 'start_application') return startApplication(interaction);

      if (action === 'add_voice_applicant') {
        if (!staffOnly(interaction.member)) {
          return interaction.reply({ content: 'هذا البانل مخصص للإدارة فقط.', ephemeral: true });
        }
        return interaction.showModal(voiceApplicantIdModal());
      }

      if (action.startsWith('app_') || action.startsWith('voice_') || action.startsWith('control_')) {
        if (!staffOnly(interaction.member)) return interaction.reply({ content: 'ليس لديك صلاحية لاستخدام هذا الزر.', ephemeral: true });
      }

      if (action === 'app_accept') return acceptWritten(interaction, applicantId);
      if (action === 'app_reject') return interaction.showModal(rejectModal('app', applicantId));
      if (action === 'voice_accept') return acceptVoice(interaction, applicantId);
      if (action === 'voice_reject') return interaction.showModal(rejectModal('voice', applicantId));

      if (action === 'control_open') {
        data.applicationsOpen = true;
        saveData();
        return interaction.reply({ content: 'تم فتح التقديم بنجاح 🔓', ephemeral: true });
      }
      if (action === 'control_close') {
        data.applicationsOpen = false;
        saveData();
        return interaction.reply({ content: `تم قفل التقديم 🔒\nالرسالة الحالية: ${data.closedMessage}`, ephemeral: true });
      }
      if (action === 'control_status') {
        return interaction.reply({
          content: `حالة التقديم: **${data.applicationsOpen ? 'مفتوح 🔓' : 'مغلق 🔒'}**\nرسالة الإغلاق: ${data.closedMessage}`,
          ephemeral: true,
        });
      }
      if (action === 'control_message') {
        const modal = new ModalBuilder().setCustomId('closed_message_modal').setTitle('رسالة قفل التقديم');
        const input = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('الرسالة التي ستظهر للأعضاء')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(data.closedMessage.slice(0, 1000))
          .setMaxLength(1000)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      const [action, applicantId] = interaction.customId.split(':');
      if (!staffOnly(interaction.member)) return interaction.reply({ content: 'ليس لديك صلاحية.', ephemeral: true });
      if (action === 'app_reject_modal') return finishReject(interaction, applicantId, 'app');
      if (action === 'voice_reject_modal') return finishReject(interaction, applicantId, 'voice');
      if (action === 'voice_applicant_id_modal') return registerVoiceById(interaction);
      if (action === 'closed_message_modal') {
        data.closedMessage = interaction.fields.getTextInputValue('message');
        saveData();
        return interaction.reply({ content: `تم حفظ رسالة الإغلاق الجديدة:\n${data.closedMessage}`, ephemeral: true });
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const payload = { content: 'حدث خطأ غير متوقع. تأكد من الآيديات وصلاحيات البوت.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  if (message.content === '!panels') {
    if (!staffOnly(message.member)) return;
    await sendPanels();
    await message.reply('تم إرسال بانلات التقديم والصوتي والكنترول في الرومات المحددة.');
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Add it to Railway Variables.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
