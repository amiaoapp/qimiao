import React,{Component,type ErrorInfo,type ReactNode} from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ClipboardWindow from "./ClipboardWindow";
import "./styles.css";
import "./styles-overrides.css";
import "./launcher-polish.css";
import "./interface.css";
import "./desktop-refinements.css";
class ErrorBoundary extends Component<{children:ReactNode},{error:string}>{state={error:""};static getDerivedStateFromError(error:Error){return{error:error.message}}componentDidCatch(error:Error,info:ErrorInfo){console.error("启喵界面异常",error,info)}render(){if(this.state.error)return <main className="stage"><section className="launcher-shell recovery"><h2>启喵遇到了一点问题</h2><p>{this.state.error}</p><button onClick={()=>{try{localStorage.removeItem("float-apps")}finally{location.reload()}}}>重置应用列表并重新加载</button></section></main>;return this.props.children}}
const standaloneClipboard = new URLSearchParams(location.search).get("window") === "clipboard";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ErrorBoundary>{standaloneClipboard ? <ClipboardWindow/> : <App/>}</ErrorBoundary></React.StrictMode>);
