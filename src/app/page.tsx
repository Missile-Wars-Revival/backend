'use client';

import { Avatar } from '@nextui-org/avatar';
import { GoogleMapsEmbed } from '@next/third-parties/google'
import { FaUserFriends } from "react-icons/fa";
import { FaUser } from "react-icons/fa";
import { MdSettings } from 'react-icons/md';
import { ToastContainer, toast } from 'react-toastify';
import { Button } from '@nextui-org/react';


export default function Home() {
  const notify = () => toast("test test est");

  return (
    <main className='no-scrollbar'>

      <div className="flex flex-col bg-zinc-900">
        <aside id="default-sidebar" className="fixed top-0 left-0 z-40 w-72 h-screen transition-transform -translate-x-full sm:translate-x-0" aria-label="Sidebar">
          <div className="h-full px-3 py-4 overflow-y-auto bg-zinc-800 ">
            <div className="flex items-center justify-between mb-6">
              <a href="/" className="text-2xl font-bold text-white">Missle Wars: Desktop</a>
              <button className="p-2 text-white bg-zinc-900 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 sm:hidden">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path>
                </svg>
              </button>
            </div>
            <nav>
              <ul>
                <li className="flex flex-row mb-4 gap-2 items-center">
                  <Avatar alt="avatar" size="lg" />
                  <div>
                    <p className="text-white">John Doe</p>
                    <p className="text-xs text-gray-400">9 friends online</p>
                  </div>

                </li>
                <li className="mb-4">
                  <a href="/" className="flex items-center text-white">
                    <FaUserFriends className="w-6 h-6 mr-2" />
                    Friends
                  </a>
                </li>
                <li className="mb-4">
                  <a href="/" className="flex items-center text-white">
                    <FaUser className="w-6 h-6 mr-2" />
                    Profile
                  </a>
                </li>
                <li className="mb-4">
                  <a href="/" className="flex items-center text-white">
                    <MdSettings className="w-6 h-6 mr-2" />
                    Settings
                  </a>
                </li>
                <Button onClick={notify}>button</Button>
              </ul>
            </nav>
          </div>
        </aside>
        <div>
          <GoogleMapsEmbed
            apiKey="AIzaSyAOVYRIgupAurZup5y1PRh8Ismb1A3lLao"
            height="1000px"
            width="100%"
            mode="place"
            q="Brooklyn+Bridge,New+York,NY"
          />
        </div>
        <ToastContainer
          position="top-right"
          autoClose={2500}
          limit={1}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="dark"
        />


      </div>
    </main>
  );
}
