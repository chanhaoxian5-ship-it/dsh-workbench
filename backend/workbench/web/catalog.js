// 预览数据集（catalog）。
//
// 这里全部是界面预览用的编造数据，不会提交给后端，也不会与真实记录混在一起。
// 约定：字段名与具名导出由渲染层（app.js / experience.js / stages.js）写死，只能扩充取值，不能改名。
// 时间基准：当前日 2026-10-30；所有日期集中在 2026-09 至 2026-11。
// 交叉引用必须自洽：versions[].stageId → stages[].id，versions[].files[] → files[].id，
// issues[].file → files[].name，files[].project → projects[].id。改动任何一处都要同步检查其余三处。

export const projects = [
  {id:'paper',   name:'非模式宿主综述',subtitle:'从递送、表达与宿主适配，梳理工程化证据',group:'科研写作',kind:'paper',   tone:'rose',  symbol:'document',status:'返修中',  date:'10月30日',next:'核对补充材料的证据边界',progress:68},
  {id:'thesis',  name:'毕业设计',      subtitle:'四种酵母的实验设计与阶段推进',      group:'科研写作',kind:'plan',    tone:'blue',  symbol:'flask',   status:'实验准备',date:'10月29日',next:'确认实验材料与阶段安排',progress:32},
  {id:'software',name:'memindex',      subtitle:'把采集、回看与信息整理连接起来',    group:'产品开发',kind:'software',tone:'teal',  symbol:'grid',    status:'开发中',  date:'10月30日',next:'完成持久化采集入口',progress:54},
  {id:'notes',   name:'写作素材库',    subtitle:'按主题归档摘录，写的时候能找回来',  group:'科研写作',kind:'area',    tone:'violet',symbol:'book',    status:'整理中',  date:'10月22日',next:'归档 9 月的读书摘录',progress:null},
  {id:'reading', name:'文献精读计划',  subtitle:'一章一章读，留下可核对的对照表',    group:'长期工作',kind:'plan',    tone:'slate', symbol:'timeline',status:'已暂停',  date:'10月18日',next:'补完第 3 章的对照表',progress:20,paused:true},
  {id:'teaching',name:'家教',          subtitle:'持续记录课程重点与教学准备',        group:'长期工作',kind:'area',    tone:'amber', symbol:'chart',   status:'持续进行',date:'10月28日',next:'准备下次物理课程',progress:null},
];

// 阶段说的是「发生了什么」，里程碑说的是「那一刻冻结了哪一版」。
// 一个阶段可以产出多个里程碑，所以归属只存在一个地方：每个版本写明它的 stageId。
// stageVersion 标记代表该阶段本身的正式版本，其余是同阶段内的工作留档。
export const stages = [
  {id:'scope',    day:'2026-09-08', date:'09月08日', title:'选题与范围', state:'done',    lines:['确定综述范围','列出对比维度']},
  {id:'reading',  day:'2026-09-18', date:'09月18日', title:'文献梳理',   state:'done',    lines:['整理 42 篇文献','标注证据类型']},
  {id:'draft',    day:'2026-09-28', date:'09月28日', title:'初稿',       state:'done',    lines:['完成初稿','搭好论证框架']},
  {id:'advisor',  day:'2026-10-08', date:'10月08日', title:'交导师',     state:'done',    lines:['提交初稿','等待反馈']},
  {id:'feedback', day:'2026-10-16', date:'10月16日', title:'导师意见',   state:'done',    lines:['收到详细意见','共 6 条建议']},
  {id:'revising', day:'2026-10-20', date:'10月20日', title:'修改中',     state:'current', lines:['逐条修改','核对图表证据']},
  {id:'submit',   day:'2026-11-06', date:'11月06日', title:'投稿',       state:'future',  lines:['准备材料','提交目标期刊'], expect:true},
  {id:'rebuttal', day:'2026-11-20', date:'11月20日', title:'返修',       state:'future',  lines:['按审稿意见','进行返修'], expect:true},
];

export const versions = [
  {id:'v3', name:'修改中',   number:'v2.2',date:'10月30日',day:'2026-10-30',state:'进行中',stageId:'revising',stageVersion:true,summary:'按导师意见逐条修改，补充实验证据并收敛讨论中的适用性表述。',done:2,total:6,files:['manuscript','supplement','response','figure','legends'],
    changes:[
      {file:'非模式宿主综述_v2.2.docx · 第 2 节',title:'重写效率定义段',summary:'先给路线与分母，再给数值；未核实条目保留未知。'},
      {file:'Supplementary_materials_v2.2.docx · S3',title:'补充表注',summary:'表注里补上适用条件，避免被读成普遍结论。'},
      {file:'Response_to_reviewers.docx',title:'逐条回复定位',summary:'每条意见标注正文位置与支持证据，页码待终稿统一更新。',note:'第 2 条与第 6 条的回复仍有交叉，合并前先与导师确认。'},
    ]},
  {id:'v3b',name:'第二轮按意见修改',number:'v2.1',date:'10月26日',day:'2026-10-26',state:'已留档',stageId:'revising',summary:'先补表注与图注措辞，再逐条回应导师意见。',done:1,total:6,files:['manuscript_v21','figure_v21'],
    changes:[{file:'Figure_2_v2.1.svg',title:'统一阶段命名',summary:'图中阶段名与正文术语对齐，箭头方向按实际顺序重排。'}]},
  {id:'v3a',name:'修改前留档',number:'v2.0.1',date:'10月20日',day:'2026-10-20',state:'已留档',stageId:'revising',summary:'动手改之前先冻结一版，方便逐条对照导师意见。',done:0,total:6,files:['manuscript_v201']},
  {id:'v2', name:'导师意见版',number:'v2.0',date:'10月16日',day:'2026-10-16',state:'已留档',stageId:'feedback',stageVersion:true,summary:'收回导师逐条意见，形成 6 条待落实清单。',done:0,total:6,files:['manuscript_v20'],
    changes:[{file:'非模式宿主综述_v2.0.docx',title:'接收意见并归档',summary:'意见原话与拟定处理分栏记录，不在正文里直接改。'}]},
  {id:'v1', name:'提交导师版',number:'v1.1',date:'10月08日',day:'2026-10-08',state:'已留档',stageId:'advisor',stageVersion:true,summary:'提交导师版，优化研究方法描述。',done:0,total:0,files:['manuscript_v11']},
  {id:'v0', name:'初稿',     number:'v1.0',date:'09月28日',day:'2026-09-28',state:'已留档',stageId:'draft',stageVersion:true,summary:'完成论文初稿，建立综述结构与证据框架。',done:0,total:0,files:['manuscript_v10','source_pdf']},
  {id:'v4', name:'投稿版',   number:'v3.0',date:'11月06日',day:'2026-11-06',state:'预计',  stageId:'submit',stageVersion:true,summary:'整合所有修改，形成最终投稿版本。',done:0,total:0,files:[]},
  {id:'v5', name:'返修版',   number:'v4.0',date:'11月20日',day:'2026-11-20',state:'预计',  stageId:'rebuttal',stageVersion:true,summary:'按审稿意见进行返修，保留每处改动的定位。',done:0,total:0,files:[]},
];

// 意见：一条意见只说三件事——原话、拟怎么处理、落到哪个文件的哪个位置。
// 状态只表示「记录的进展」，不表示论文已经改好。
export const issues = [
  {id:1,title:'明确递送效率的定义与证据边界',quote:'请区分不同实验条件下的效率定义，并补充表注说明分母。',plan:'在补充表 S3 里补路线、分母与适用条件；未核实条目保留未知，不写成普遍结论。',status:'待核对',tone:'amber',file:'Supplementary_materials_v2.2.docx',location:'补充表 S3 · 定义与表注'},
  {id:2,title:'补充正文与 Figure 2 的对应关系',quote:'图中阶段划分应与正文术语一致，箭头方向按实际顺序。',plan:'统一阶段命名，逐项核对正文中的图引用与箭头方向。',status:'处理中',tone:'blue',file:'Figure_2.svg',location:'正文第 2 节 · Figure 2'},
  {id:3,title:'说明敏感性分析的比较范围',quote:'请说明阈值改变时哪些结论保持稳定。',plan:'写明分析范围与阈值取值，避免把局部变化写成普遍结论。',status:'已落实',tone:'teal',file:'非模式宿主综述_v2.2.docx',location:'正文第 5 节 · 补充表 S5'},
  {id:4,title:'调整表格中的缩写与阅读说明',quote:'首次出现的缩写需要解释，便于跨领域阅读。',plan:'在表注集中解释缩写，并保留完整来源。',status:'已落实',tone:'teal',file:'Supplementary_materials_v2.2.docx',location:'补充表 S4 · 表注'},
  {id:5,title:'核对图注、正文与参考文献编号',quote:'请检查图注中的术语和文献编号是否与正文一致。',plan:'逐图核对术语，最后统一更新行号与文献编号。',status:'待处理',tone:'rose',file:'Figure_legends.docx',location:'图注 · Figure 2–4'},
  {id:6,title:'收敛讨论中的适用性表述',quote:'请区分已有实验支持的部分与未来研究方向。',plan:'收紧结论，补上适用条件与未验证事项。',status:'处理中',tone:'blue',file:'非模式宿主综述_v2.2.docx',location:'正文第 6 节 · 讨论'},
];

// 文件：一份文件引用只说四件事——它在哪个项目、哪个目录、哪一版、是什么类型。
// icon 只用标准文件类型名（file-text / file-pdf / file-markdown / file-code /
// file-sheet / file-image / file-zip），按类型取图形，不按主题自造。
export const files = [
  {id:'manuscript',     name:'非模式宿主综述_v2.2.docx',          type:'Word',    size:'2.4 MB',project:'paper',   date:'10月30日 14:30',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v3',  preview:'返修稿 · v2.2\n\n本轮修改围绕效率定义、条件边界与证据对应关系展开。\n研究结果、作者解释与未来建议分开表述；缺少可核实依据的条目保留未知。\n\n待办：第 2 节的效率定义段需与 Supplementary S3 的表注对齐。'},
  {id:'supplement',     name:'Supplementary_materials_v2.2.docx', type:'Word',    size:'1.8 MB',project:'paper',   date:'10月30日 11:20',folder:'supplement', icon:'file-text',    tone:'blue',  version:'v3',  preview:'补充材料 · v2.2\n\nS3 · 路线、分母与效率定义\nS4 · 评分规则与证据索引\nS5 · 敏感性分析的阈值范围\n\n表注需写明适用条件；未核实项保留未知。'},
  {id:'response',       name:'Response_to_reviewers.docx',        type:'Word',    size:'890 KB',project:'paper',   date:'10月29日 10:15',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v3',  preview:'逐条回复 · 草稿\n\n意见原话 → 修改说明 → 正文位置 → 支持证据\n\n页码与行号在终稿确认后统一更新；第 2 条与第 6 条的回复仍有交叉。'},
  {id:'figure',         name:'Figure_2.svg',                      type:'SVG',     size:'128 KB',project:'paper',   date:'10月29日 16:10',folder:'figures',    icon:'file-image',   tone:'violet',version:'v3',  preview:'figure'},
  {id:'legends',        name:'Figure_legends.docx',               type:'Word',    size:'210 KB',project:'paper',   date:'10月29日 15:40',folder:'figures',    icon:'file-text',    tone:'blue',  version:'v3',  preview:'图注 · Figure 2–4\n\nFigure 2  阶段关系：递送 → 表达 → 宿主适配。\nFigure 3  不同条件下的效率对比（分母见补充表 S3）。\nFigure 4  敏感性分析中阈值变化的影响。'},
  {id:'manuscript_v21', name:'非模式宿主综述_v2.1.docx',          type:'Word',    size:'2.3 MB',project:'paper',   date:'10月26日 15:40',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v3b', preview:'第二轮修改 · v2.1\n\n先补表注与图注措辞，再逐条回应导师意见。'},
  {id:'figure_v21',     name:'Figure_2_v2.1.svg',                 type:'SVG',     size:'131 KB',project:'paper',   date:'10月26日 15:40',folder:'figures',    icon:'file-image',   tone:'violet',version:'v3b', preview:'figure'},
  {id:'manuscript_v201',name:'非模式宿主综述_v2.0.1.docx',        type:'Word',    size:'2.2 MB',project:'paper',   date:'10月20日 10:05',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v3a', preview:'修改前留档 · v2.0.1\n\n动手改之前先冻结一版，方便逐条对照导师意见。'},
  {id:'manuscript_v20', name:'非模式宿主综述_v2.0.docx',          type:'Word',    size:'2.2 MB',project:'paper',   date:'10月16日 18:40',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v2',  preview:'导师意见版 · v2.0\n\n按导师逐条意见调整正文结构与结果表述，并补充实验证据。'},
  {id:'manuscript_v11', name:'非模式宿主综述_v1.1.docx',          type:'Word',    size:'2.0 MB',project:'paper',   date:'10月08日 09:20',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v1',  preview:'提交导师版 · v1.1\n\n优化研究方法描述，明确证据边界与适用条件。'},
  {id:'manuscript_v10', name:'非模式宿主综述_v1.0.docx',          type:'Word',    size:'1.9 MB',project:'paper',   date:'09月28日 21:10',folder:'manuscript', icon:'file-text',    tone:'blue',  version:'v0',  preview:'初稿 · v1.0\n\n建立整篇综述的结构与证据框架，完成初步分析。'},
  {id:'source_pdf',     name:'文献来源.pdf',                      type:'PDF',     size:'3.2 MB',project:'paper',   date:'09月28日 09:40',folder:'references', icon:'file-pdf',     tone:'rose',  version:'v0',  preview:null},

  {id:'thesis_plan',    name:'实验设计_v0.6.md',                  type:'Markdown',size:'18 KB', project:'thesis',  date:'10月29日 20:10',folder:'docs',       icon:'file-markdown',tone:'blue',  preview:'# 实验设计 v0.6\n\n四种酵母：BY4741、CEN.PK、YPH499、X2180。\n\n- 每组 3 个生物学重复\n- 培养条件与取样时间统一记录\n- 先记录原始读数，再做归一化\n\n材料清单尚未最终确认。'},
  {id:'thesis_sheet',   name:'菌株与材料清单.csv',                type:'CSV',     size:'6 KB',  project:'thesis',  date:'10月29日 18:00',folder:'materials',  icon:'file-sheet',   tone:'teal',  preview:null},
  {id:'thesis_proto',   name:'培养方案_草稿.docx',                type:'Word',    size:'420 KB',project:'thesis',  date:'10月27日 11:30',folder:'docs',       icon:'file-text',    tone:'blue',  preview:'培养方案（草稿）\n\n温度与摇床转速按预实验取值；正式实验前需再确认一次。'},

  {id:'mem_plan',       name:'PLAN.md',                           type:'Markdown',size:'9 KB',  project:'software',date:'10月30日 13:00',folder:'docs',       icon:'file-markdown',tone:'teal',  preview:'# 当前计划\n\n- 完成持久化采集入口\n- 保留原始记录与修订历史\n- 进行真实设备验证\n\n工程检查与实际验收分开记录。'},
  {id:'mem_capture',    name:'capture.mjs',                       type:'JS',      size:'14 KB', project:'software',date:'10月30日 12:20',folder:'src',        icon:'file-code',    tone:'teal',  preview:'// 采集入口：先落盘，再回读确认\nexport async function capture(payload) {\n  const record = await writeOnce(payload);\n  return readBack(record.id);\n}'},
  {id:'mem_schema',     name:'schema.json',                       type:'JSON',    size:'5 KB',  project:'software',date:'10月29日 22:05',folder:'src',        icon:'file-code',    tone:'teal',  preview:null},
  {id:'mem_bundle',     name:'v0.4-构建产物.zip',                 type:'ZIP',     size:'6.1 MB',project:'software',date:'10月29日 09:15',folder:'build',      icon:'file-zip',     tone:'slate', preview:null},

  {id:'notes_index',    name:'摘录索引.md',                       type:'Markdown',size:'22 KB', project:'notes',   date:'10月22日 21:00',folder:'index',      icon:'file-markdown',tone:'violet',preview:'# 摘录索引\n\n按主题归档，每条摘录保留来源与页码。\n\n## 学术表达\n## 方法与证据\n## 工具与方法'},
  {id:'notes_clip',     name:'读书摘录_10月.docx',                type:'Word',    size:'340 KB',project:'notes',   date:'10月22日 20:10',folder:'clips',      icon:'file-text',    tone:'blue',  preview:'十月读书摘录\n\n只保留能回到原文的定位信息，不复制整段正文。'},

  {id:'reading_map',    name:'精读对照表.csv',                    type:'CSV',     size:'12 KB', project:'reading', date:'10月18日 16:40',folder:'tables',     icon:'file-sheet',   tone:'slate', preview:null},
  {id:'reading_ch3',    name:'第3章_笔记.md',                     type:'Markdown',size:'15 KB', project:'reading', date:'10月18日 15:20',folder:'notes',      icon:'file-markdown',tone:'violet',preview:'# 第 3 章\n\n对照表尚未补完；作者的解释与测量结果分开记录。'},

  {id:'teach_plan',     name:'牛顿运动定律_课堂笔记.docx',        type:'Word',    size:'280 KB',project:'teaching',date:'10月28日 19:30',folder:'lessons',    icon:'file-text',    tone:'blue',  preview:'受力分析：先定研究对象，再逐个说明每个力的来源。\n\n易错点：把「运动方向」当成「合力方向」。'},
  {id:'teach_quiz',     name:'课堂练习_受力分析.pdf',             type:'PDF',     size:'1.1 MB',project:'teaching',date:'10月28日 19:10',folder:'lessons',    icon:'file-pdf',     tone:'rose',  preview:null},
];

// 重要变化：只说「什么变了、需要核对什么」，不替用户下结论。
export const changes = [
  {id:'notice',  project:'thesis',  title:'毕设材料要求更新',summary:'附件增加了实验记录的提交要求，需要先核对适用范围再决定是否调整计划。',source:'学校通知 · 附件要求',time:'2小时前',tone:'rose',icon:'file-text'},
  {id:'feedback',project:'paper',   title:'本轮论文反馈已整理',summary:'6 条意见已关联到本轮版本，2 项已落实，4 项仍待处理或核对。',source:'非模式宿主综述 · 导师意见',time:'4小时前',tone:'blue',icon:'document'},
  {id:'material',project:'thesis',  title:'实验材料清单有更新',summary:'菌株清单补入两种质粒，材料准备阶段需要重新确认。',source:'毕业设计 · 材料清单',time:'昨天',tone:'teal',icon:'file-sheet'},
];

// 今日发现：主题是「它属于哪一类」，不是「它很急」，所以分类一律中性标签。
// generated_at / received_at 倒序；渲染层按 sequence 展示。
const themes = [
  ['用语辨析：区分抑制与降低','学术表达','Inhibition of this pathway may reduce downstream product formation.','这条是自编学习例句：机制受到抑制与观察到产物降低要分开写，前者是机制推断，后者是测量结果。','rose'],
  ['方法启发：让不同条件下的结果可比较','方法与证据','Comparisons require the same task, the same unit, and the same denominator.','仅有相同单位并不意味着可以直接比较；先把证据边界写清楚，再谈能不能迁移。','blue'],
  ['工作方法：给每条结论留一个来源入口','工具与方法','Every claim keeps a locator back to the file and the position that supports it.','保留少量有用的定位信息，往往比复制整篇内容更便于回到工作。','teal'],
  ['阅读提示：从作者测量到什么开始','论文阅读','Start from what was measured, then read what the authors claim it means.','把结果、解释与适用范围分开阅读，可以更准确地判断一项研究的支持力度。','violet'],
  ['表述练习：把「显著」留给统计结论','学术表达','Reserve "significant" for the test result, not for the size of the effect.','口语里的「明显」与统计上的「显著」不是同一件事，混用会让读者误读结论。','rose'],
  ['证据边界：区分未验证与已被否定','方法与证据','Absence of evidence is not evidence of absence.','没有找到支持证据，只能记作未知；只有反向实验才能写成否定。','blue'],
  ['整理方法：先定分类再收集','工具与方法','Decide the shelf before you buy the books.','先定分类再收集，后面的检索成本会低一个量级。','teal'],
  ['阅读提示：图表先看坐标与标注','论文阅读','Read the axes and the caption before you read the trend.','坐标范围与图注决定了这条趋势最多能支持多大的结论。','violet'],
  ['表述练习：把适用范围写进句子','学术表达','State the conditions in the same sentence as the conclusion.','把适用条件写进结论句，比放在段末更容易被读到。','amber'],
  ['复核提示：让第二次读的人能看到差异','工具与方法','Make the diff visible to the second reader.','留下改动位置，复核时才能逐条对照，而不是重读全文。','slate'],
];
export const discoveries = themes.map(([title,theme,excerpt,interpretation,tone],i)=>({
  record_id:`preview-discovery-${i+1}`,title,theme,tone,excerpt,interpretation,
  generated_at:`2026-10-30T0${Math.max(1,9-i)}:00:00Z`,
  received_at:`2026-10-30T0${Math.max(1,9-i)}:02:00Z`,
  is_test:i===7,
  revision_of:i===9?'preview-discovery-3':null,
  superseded_by:null,
  verification:{
    mechanical:{status:'not_checked',scope:'仅用于界面预览',evidence:null},
    semantic:{status:'not_reviewed',reviewed_by:null,evidence:null},
  },
  source:{type:'unknown',pdf_page:null,printed_page:null,parent_key:null,attachment_key:null,local_path:null,sha256:null},
  source_locator:{status:'not_provided'},
  producer:{harness:'DSH',profile:'desktop',working_directory:null,main_session_id:null,main_session_title:null,production_session_id:null,run_id:null},
  revision_history:[i===9?'preview-discovery-3':`preview-discovery-${i+1}`],
  content_sha256:null,
  sequence:i+1,
}));

// 预览 API：只回答界面需要的形状，不读磁盘、不连后端。
// 真实接入时，这几条路由分别对应 server.py 的 /v1/health、/v1/home、/v1/discoveries。
export function previewApi(path) {
  const url=new URL(path,'http://preview.invalid');
  if(url.pathname==='/v1/health')return {schema_version:1,status:'ok'};
  if(url.pathname==='/v1/home')return {schema_version:1,date:'2026-10-30',today_discoveries:{items:discoveries.slice(0,3),next_before:null,window:{}},important_changes:changes};
  if(url.pathname==='/v1/discoveries')return {schema_version:1,items:discoveries,next_before:null,window:{}};
  const id=decodeURIComponent(url.pathname.split('/').pop());
  const record=discoveries.find(d=>d.record_id===id);
  if(record)return record;
  throw new Error('预览记录不存在');
}
