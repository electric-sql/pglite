import { toast } from 'react-toastify'

export function showWarning(msg: string, title: string = ``) {
  //TODO: make notification showing from bottom
  const content = (
    <div className="flex flex-col">
      {title !== `` && (
        <div
          className={`font-medium text-sm w-full text-gray-700 flex items-center`}
        >
          <span className="flex items-center justify-center w-4 h-4 bg-gray-200 rounded-full">
            <svg width="4" height="9" viewBox="0 0 3 9">
              <path d="M0.920455 9H1.92614V2.45455H0.920455V9ZM1.43182 1.38068C1.82386 1.38068 2.14773 1.07386 2.14773 0.698864C2.14773 0.323864 1.82386 0.0170453 1.43182 0.0170453C1.03977 0.0170453 0.715909 0.323864 0.715909 0.698864C0.715909 1.07386 1.03977 1.38068 1.43182 1.38068Z"></path>
            </svg>
          </span>
          <span className="ml-2">{title}</span>
        </div>
      )}
      <div className="w-full mt-2 text-xs font-normal text-gray-500">{msg}</div>
    </div>
  )
  toast(content, {
    position: `bottom-right`,
  })
}

export function showInfo(msg: string, title: string = ``) {
  //TODO: make notification showing from bottom
  const content = (
    <div className="flex flex-col">
      {title !== `` && (
        <div
          className={`font-medium text-sm w-full text-gray-700 flex items-center`}
        >
          <span className="flex items-center justify-center w-4 h-4 bg-indigo-700 rounded-full">
            <svg width="10" height="7" viewBox="0 0 9 7" fill="#fff">
              <path d="M3.29974 4.8648L1.64132 3.20637C1.45492 3.01998 1.15383 3.01998 0.967432 3.20637C0.781038 3.39277 0.781038 3.69387 0.967432 3.88026L2.96519 5.87802C3.15158 6.06441 3.45268 6.06441 3.63907 5.87802L8.6956 0.821492C8.88199 0.635099 8.88199 0.334001 8.6956 0.147608C8.50921 -0.0387859 8.20811 -0.0387859 8.02171 0.147608L3.29974 4.8648Z"></path>
            </svg>
          </span>
          <span className="ml-2">{title}</span>
        </div>
      )}
      <div className="w-full mt-2 text-xs font-normal text-gray-500">{msg}</div>
    </div>
  )
  toast(content, {
    position: `bottom-right`,
  })
}
