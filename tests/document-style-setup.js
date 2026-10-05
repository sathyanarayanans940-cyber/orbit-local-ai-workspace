const escapeHtml=OrbitWidgets.escape,widgetBlobs=new Map();
const isDocxFile=a=>/\.docx$/.test(a.name),isSpreadsheetFile=a=>/\.xlsx$/.test(a.name),isPdfFile=a=>/\.pdf$/.test(a.name),isImageFile=()=>false,isPptxFile=()=>false;
const state={messages:[],attachments:[]};
