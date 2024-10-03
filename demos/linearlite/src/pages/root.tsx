import { Outlet } from 'react-router-dom'
import LeftMenu from '../components/LeftMenu'
import { cssTransition, ToastContainer } from 'react-toastify'

const slideUp = cssTransition({
  enter: `animate__animated animate__slideInUp`,
  exit: `animate__animated animate__slideOutDown`,
})

export default function Root() {
  return (
    <div>
      <div className="flex w-full h-screen overflow-y-hidden">
        <LeftMenu />
        <Outlet />
      </div>
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar
        newestOnTop
        closeOnClick
        rtl={false}
        transition={slideUp}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </div>
  )
}
