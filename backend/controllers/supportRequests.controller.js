const service=require("../services/supportRequests.service");
const {HttpError}=require("../errors");
function fail(res,err){ if(err instanceof HttpError) return res.status(err.status).json({success:false,message:err.message,error:err.message}); console.error("[SUPPORT]",err); return res.status(500).json({success:false,message:"Lỗi server, vui lòng thử lại sau!",error:"Lỗi server, vui lòng thử lại sau!"}); }
function action(fn,status=200){ return async(req,res)=>{try{const data=await fn(req);return res.status(status).json({success:true,message:"Thành công!",data});}catch(e){return fail(res,e);}}; }
const mine=action(req=>service.mine(req.user,req.query));
const create=action(req=>service.create(req.user,req.body),201);
const cancel=action(req=>service.cancel(req.user,req.params.id));
const list=action(req=>service.listHr(req.query));
const detail=action(req=>service.detail(req.params.id));
const process=action(req=>service.process(req.user,req.params.id,req.body));
const uploadMine=action(req=>service.upload(req.user,req.params.id,req.file,"REQUEST",null),201);
const uploadResult=action(req=>service.upload(req.user,req.params.id,req.file,"RESULT"),201);
const removeAttachment=action(req=>service.removeAttachment(req.user,req.params.id,req.params.attachmentId));
const removeResultAttachment=action(req=>service.removeResultAttachment(req.params.id,req.params.attachmentId));
async function download(req,res){try{const f=await service.download(req.user,req.params.id,req.params.attachmentId);res.set("Cache-Control","private, no-store").set("X-Content-Type-Options","nosniff");return res.download(f.filePath,f.originalName);}catch(e){return fail(res,e);}}
module.exports={mine,create,cancel,list,detail,process,uploadMine,uploadResult,removeAttachment,removeResultAttachment,download};
