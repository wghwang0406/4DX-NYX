import { createRoot } from 'react-dom/client'
import App from './App'
import Overview from './Overview'
import './styles.css'

// 리뷰 링크(/r/토큰)는 리뷰어 화면, 루트(/)는 서버 현황 (게시 토큰으로 잠김)
const isReview = location.pathname.startsWith('/r/')
createRoot(document.getElementById('root')!).render(isReview ? <App /> : <Overview />)
